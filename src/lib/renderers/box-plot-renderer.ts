import type { BoxPlotChunkResult } from "../sift-core.js";

export interface BoxPlotDrawOptions {
  xLabel?: string;
  yLabel?: string;
  legendText?: string;
  placeholder?: string;
  showGrid?: boolean;
  showAxisLabels?: boolean;
  precision?: number;
  /** Прогресс: сколько обработано из скольких. */
  processed?: number;
  total?: number;
  /**
   * Ориентация диаграммы. По умолчанию "vertical" — поведение
   * существующей вертикальной диаграммы не меняется.
   * "horizontal": ось значений идёт по X, ящик повёрнут.
   */
  orientation?: "vertical" | "horizontal";
  /** Принудительный выбор шкалы значений. "auto" — эвристика min > 0. */
  scaleMode?: "auto" | "linear" | "log";
  /** Рисовать ромбик среднего (state.mean). */
  showMean?: boolean;
  /** Рисовать сырые точки под ящиком. */
  showRawPoints?: boolean;
  /** Сырые значения для showRawPoints. */
  rawData?: Float64Array | null;
  /** Рисовать талию (notch) на уровне медианы. */
  notch?: boolean;
}

export interface BoxPlotHitInfo {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  count: number;
  mean: number;
}

export class BoxPlotRenderer {
  private ctx: CanvasRenderingContext2D;
  private hasData = false;
  /** Предупреждение о невозможности лог-шкалы — один раз, не каждый кадр. */
  private logFallbackWarned = false;
  private lastPlot: {
    padL: number;
    padT: number;
    plotW: number;
    plotH: number;
    vMin: number;
    vMax: number;
    result: BoxPlotChunkResult;
  } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D недоступен");
    this.ctx = ctx;
  }

  resize(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(state: BoxPlotChunkResult | null, opts: BoxPlotDrawOptions = {}) {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    // Горизонтальная ориентация — отдельный путь отрисовки.
    // Вертикальный код ниже остаётся без изменений.
    if (opts.orientation === "horizontal") {
      this.drawHorizontal(state, opts);
      return;
    }

    const showGrid = opts.showGrid !== false;
    const showAxisLabels = opts.showAxisLabels !== false;
    const precision =
      typeof opts.precision === "number" ? opts.precision : 2;

    const AXIS_FONT = "12px -apple-system, sans-serif";
    const AXIS_COLOR = "#000000";

    // ---- Y-диапазон ----
    //
    // Логарифмическая шкала: revenue, price, income — все имеют
    // лог-нормальную форму. В лог-координатах ящик становится
    // видимым, а выбросы равномерно ложатся вокруг него.
    //
    // Защита: если min <= 0 (например, есть отрицательные profit),
    // fallback на линейную шкалу — log(0) не определён.
    const scaleMode = opts.scaleMode ?? "auto";
    const { useLog, logFallback } = resolveScale(
      scaleMode,
      state ? state.count : 0,
      state ? state.min : 0,
    );
    // Edge case 3.1: log запросили, но min <= 0 / count < 5.
    this.warnLogFallback(logFallback, scaleMode);

    let vMin = 0;
    let vMax = 1;
    let logMin = 0;
    let logMax = 1;

    if (state && state.count >= 5) {
      if (useLog) {
        logMin = Math.log10(state.min);
        logMax = Math.log10(state.max);
        // Расширяем диапазон на 3% сверху/снизу
        const logSpan = logMax - logMin || 1;
        logMin -= logSpan * 0.03;
        logMax += logSpan * 0.03;
      } else {
        vMin = state.min;
        vMax = state.max;
        const span = vMax - vMin || 1;
        vMin -= span * 0.05;
        vMax += span * 0.05;
      }
    }

    // Универсальный перевод значения в Y-пиксель
    const valueToY = (v: number): number => {
      if (useLog) {
        const lv = Math.log10(Math.max(v, 1e-12));
        return padT + plotH - ((lv - logMin) / (logMax - logMin)) * plotH;
      }
      return padT + plotH - ((v - vMin) / (vMax - vMin)) * plotH;
    };

    // Универсальный формат подписи — свой для log и linear
    const formatTick = (v: number): string => {
      if (useLog) {
        if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
        return v.toFixed(0);
      }
      return formatNumberPrecise(v, precision);
    };

    // ---- padL: подписи оси Y ----
    let padL = 60;
    if (showAxisLabels) {
      ctx.font = AXIS_FONT;
      let maxYLabelW = 0;
      for (let i = 0; i <= 5; ++i) {
        const v = vMin + ((vMax - vMin) * i) / 5;
        const w = ctx.measureText(formatNumberPrecise(v, precision)).width;
        if (w > maxYLabelW) maxYLabelW = w;
      }
      padL = Math.max(60, 14 + Math.ceil(maxYLabelW) + 16);
    }

    const padR = 20;

    // ---- Резерв места сверху под легенду ----
    const hasLegend = !!opts.legendText;
    const LEGEND_FONT = "11px -apple-system, sans-serif";
    const LEGEND_SWATCH = 11;
    const LEGEND_PAD = 8;
    const LEGEND_H = hasLegend ? 22 : 0;
    const LEGEND_GAP = hasLegend ? 6 : 0;

    const padT = 20 + LEGEND_H + LEGEND_GAP;
    const axisXLabelH = opts.xLabel ? 20 : 0;
    const padB = 12 + axisXLabelH + 20;

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (plotW <= 10 || plotH <= 10) {
      this.hasData = false;
      return;
    }

    // ---- Оси ----
    ctx.strokeStyle = "#c8cfd8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // ---- Плейсхолдер ----
    if (!state || state.count < 5) {
      this.hasData = false;
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        opts.placeholder ?? "Нужно минимум 5 числовых значений",
        padL + plotW / 2,
        padT + plotH / 2,
      );
      return;
    }

    // ---- Y-ticks ----
    // (valueToY определён выше, вместе с лог-логикой)

    // Считаем позиции тиков — 6 штук, равномерно по пикселям
    // (для лог-шкалы это не «равномерно по значениям», а «по логарифмам»).
    const tickYPositions: number[] = [];
    const tickValues: number[] = [];

    for (let i = 0; i <= 5; ++i) {
      const t = i / 5;
      const y = padT + plotH - t * plotH;
      tickYPositions.push(y);

      if (useLog) {
        tickValues.push(Math.pow(10, logMin + t * (logMax - logMin)));
      } else {
        tickValues.push(vMin + t * (vMax - vMin));
      }
    }

    if (showGrid) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (let i = 1; i < 5; ++i) {
        ctx.beginPath();
        ctx.moveTo(padL, tickYPositions[i]);
        ctx.lineTo(padL + plotW, tickYPositions[i]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 5; ++i) {
        ctx.fillText(formatTick(tickValues[i]), padL - 8, tickYPositions[i]);
      }
    }

    // ---- Основные координаты box plot ----
    // Всё, что использует cx / boxWidth / yQ1 / yMed / yQ3 ниже,
    // опирается на эти пять величин.
    const cx = padL + plotW / 2;
    const boxWidth = Math.min(plotW * 0.35, 160);

    const yQ1  = valueToY(state.q1);
    const yMed = valueToY(state.median);
    const yQ3  = valueToY(state.q3);

    // Усы идут не до min/max, а до fences = Q3 + 1.5·IQR и Q1 − 1.5·IQR.
    // Если данные их не достигают — обрезаем по фактическим min/max.
    const hasFences =
      typeof state.upperFence === "number" &&
      typeof state.lowerFence === "number";

    const upperWhiskerVal = hasFences
      ? Math.min(state.max, state.upperFence)
      : state.max;
    const lowerWhiskerVal = hasFences
      ? Math.max(state.min, state.lowerFence)
      : state.min;

    const yUpperWhisker = valueToY(upperWhiskerVal);
    const yLowerWhisker = valueToY(lowerWhiskerVal);

    // Границы plot area — для клипа сырых точек и ромбика среднего.
    const plotClip = { x: padL, y: padT, w: plotW, h: plotH };

    const accent = "#4a9eff";
    const accentDark = "#2563eb";

    // Усы: от Q1 вниз до нижнего уса и от Q3 вверх до верхнего уса
    ctx.strokeStyle = accentDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, yLowerWhisker);
    ctx.lineTo(cx, yQ1);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, yQ3);
    ctx.lineTo(cx, yUpperWhisker);
    ctx.stroke();

    // Капы на концах усов
    const capW = boxWidth * 0.4;
    ctx.beginPath();
    ctx.moveTo(cx - capW / 2, yLowerWhisker);
    ctx.lineTo(cx + capW / 2, yLowerWhisker);
    ctx.moveTo(cx - capW / 2, yUpperWhisker);
    ctx.lineTo(cx + capW / 2, yUpperWhisker);
    ctx.stroke();

    // ---- Сырые точки (под ящиком) ----
    if (opts.showRawPoints === true && opts.rawData) {
      this.drawRawPoints(opts.rawData, {
        limit: state.processed,
        vertical: true,
        center: cx,
        jitterRange: boxWidth * 0.5,
        color: "rgba(37, 99, 235, 0.35)",
        toPos: valueToY,
        clip: plotClip,
        // Edge case 3.4: выбросы не дублируем — у них отдельный слой.
        loFence: state.q1 - 1.5 * state.iqr,
        hiFence: state.q3 + 1.5 * state.iqr,
        maxPoints: MAX_RAW_POINTS,
      });
    }

    // Ящик Q1..Q3 (с опциональной талией)
    const gradient = ctx.createLinearGradient(0, yQ3, 0, yQ1);
    gradient.addColorStop(0, "rgba(74, 158, 255, 0.20)");
    gradient.addColorStop(1, "rgba(74, 158, 255, 0.08)");

    const boxHalfW = boxWidth / 2;
    const yTop = Math.min(yQ1, yQ3);
    const yBottom = Math.max(yQ1, yQ3);
    const boxHpx = Math.max(1, yBottom - yTop);

    // Edge case 3.6/3.7: талия ограничена (Q3−Q1)/2, свободным местом
    // до Q1/Q3 и 45% полуширины ящика; при IQR == 0 не рисуется.
    const notch = this.notchInsets(
      opts.notch === true,
      state.iqr,
      state.count,
      boxHpx,
      boxHalfW,
      Math.abs(yMed - yTop),
      Math.abs(yBottom - yMed),
    );
    const drawNotch = notch.before > 0.5 && notch.after > 0.5;

    if (drawNotch) {
      ctx.beginPath();
      ctx.moveTo(cx - boxHalfW, yTop);
      ctx.lineTo(cx - boxHalfW, yMed - notch.before);
      ctx.lineTo(cx - boxHalfW + notch.before, yMed);
      ctx.lineTo(cx - boxHalfW, yMed + notch.after);
      ctx.lineTo(cx - boxHalfW, yBottom);
      ctx.lineTo(cx + boxHalfW, yBottom);
      ctx.lineTo(cx + boxHalfW, yMed + notch.after);
      ctx.lineTo(cx + boxHalfW - notch.after, yMed);
      ctx.lineTo(cx + boxHalfW, yMed - notch.before);
      ctx.lineTo(cx + boxHalfW, yTop);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = accentDark;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = gradient;
      ctx.fillRect(cx - boxHalfW, yQ3, boxWidth, yQ1 - yQ3);

      ctx.strokeStyle = accentDark;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        cx - boxHalfW + 0.5,
        yQ3 + 0.5,
        boxWidth - 1,
        yQ1 - yQ3 - 1,
      );
    }

    // Медиана
    ctx.strokeStyle = accentDark;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - boxWidth / 2, yMed);
    ctx.lineTo(cx + boxWidth / 2, yMed);
    ctx.stroke();

    // ---- Среднее (ромбик) ----
    // Edge case 3.2: вне plot area маркер не рисуется (проверка внутри
    // drawMeanMarker + клип по границам).
    if (
      opts.showMean === true &&
      state.count > 0 &&
      Number.isFinite(state.mean)
    ) {
      this.drawMeanMarker(cx, valueToY(state.mean), plotClip);
    }

    // ---- Выбросы ----
    // Рисуем точками. Стабильный jitter, чтобы не «дрожали»
    // между кадрами при прогрессивной отрисовке.
    const jitterRange = boxWidth * 0.5;
    const drawOutliers = (arr: number[]) => {
      if (!arr || arr.length === 0) return;
      ctx.fillStyle = accentDark;
      for (const v of arr) {
        const y = valueToY(v);
        const dx = outlierJitter(v, jitterRange);
        ctx.beginPath();
        ctx.arc(cx + dx, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (state.done) {
      drawOutliers(state.upperOutliers);
      drawOutliers(state.lowerOutliers);
    }

    // ---- Подпись «+N скрытых» ----
    // Если выбросов больше, чем мы физически передали из C++
    // (MAX_OUTLIERS = 500), покажем их количество сбоку.
    if (
      state.done &&
      state.upperOutlierCount > (state.upperOutliers?.length ?? 0)
    ) {
      const hidden = state.upperOutlierCount - state.upperOutliers.length;
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(
        `+${hidden.toLocaleString("ru-RU")} выбросов`,
        cx + boxWidth / 2 + 6,
        yUpperWhisker - 6,
      );
    }

    // ---- Легенда (над plot area, не перекрывает данные) ----
    // try/catch: ошибка отрисовки легенды не должна крашить всю диаграмму.
    if (hasLegend && opts.legendText) {
      try {
        ctx.font = LEGEND_FONT;
        const textW = ctx.measureText(opts.legendText).width;
        const legendW = LEGEND_PAD * 2 + LEGEND_SWATCH + 6 + textW;
        const legendX = padL + plotW - legendW;
        const legendY = 8;

        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.strokeStyle = "#d8dde3";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === "function") {
          (ctx as any).roundRect(legendX, legendY, legendW, LEGEND_H, 4);
        } else {
          ctx.rect(legendX, legendY, legendW, LEGEND_H);
        }
        ctx.fill();
        ctx.stroke();

        const swatchY = legendY + (LEGEND_H - LEGEND_SWATCH) / 2;
        const swatchX = legendX + LEGEND_PAD;
        const swatchGrad = ctx.createLinearGradient(
          swatchX,
          0,
          swatchX + LEGEND_SWATCH,
          0,
        );
        swatchGrad.addColorStop(0, accent);
        swatchGrad.addColorStop(1, accentDark);
        ctx.fillStyle = swatchGrad;
        ctx.fillRect(swatchX, swatchY, LEGEND_SWATCH, LEGEND_SWATCH);
        ctx.strokeStyle = accentDark;
        ctx.strokeRect(
          swatchX + 0.5,
          swatchY + 0.5,
          LEGEND_SWATCH - 1,
          LEGEND_SWATCH - 1,
        );

        ctx.fillStyle = "#334155";
        ctx.font = LEGEND_FONT;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(
          opts.legendText,
          swatchX + LEGEND_SWATCH + 6,
          legendY + LEGEND_H / 2,
        );
      } catch (e) {
        console.error("[BoxPlotRenderer] Легенда (vertical):", e);
      }
    }

    // ---- X-подпись ----
    if (opts.xLabel) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, padL + plotW / 2, H - 22);
    }

    // ---- Y-подпись ----
    if (opts.yLabel) {
      const yLabelX = 12;
      ctx.save();
      ctx.translate(yLabelX, padT + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }

    // ---- Прогресс-полоса снизу ----
    const processed = opts.processed ?? state.processed ?? 0;
    const total = opts.total ?? state.total ?? 0;
    const progress = total > 0 ? processed / total : 0;

    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(padL, H - 3, plotW, 2);
    ctx.fillStyle = accent;
    ctx.fillRect(padL, H - 3, plotW * progress, 2);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${(progress * 100).toFixed(1)}% · ${processed.toLocaleString("ru-RU")} из ${total.toLocaleString("ru-RU")}`,
      padL + plotW,
      H - 6,
    );

    // ---- Σ — сумма отрисованных / общее число обработанных — слева ----
    // Формат и семантика совпадают с остальными рендерерами:
    //   Σ <включено> / <всего>
    // Зелёный — если всё включено, красный — если что-то отфильтровано.
    ctx.textAlign = "left";
    const sumText = `Σ ${state.count.toLocaleString("ru-RU")} / ${total.toLocaleString("ru-RU")}`;
    ctx.fillStyle = state.count === total ? "#16a34a" : "#dc2626";
    ctx.fillText(sumText, padL, H - 6);

    this.lastPlot = {
      padL,
      padT,
      plotW,
      plotH,
      vMin,
      vMax,
      result: state,
    };
    this.hasData = true;
  }

  /**
   * Горизонтальный вариант: ось значений — X (внизу), категориальная
   * ось — Y (слева). Шкала (log/linear), усы, выбросы и прогресс
   * считаются по тем же правилам, что и в вертикальном варианте.
   */
  private drawHorizontal(
    state: BoxPlotChunkResult | null,
    opts: BoxPlotDrawOptions,
  ) {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const ctx = this.ctx;

    const showGrid = opts.showGrid !== false;
    const showAxisLabels = opts.showAxisLabels !== false;
    const precision =
      typeof opts.precision === "number" ? opts.precision : 2;

    const AXIS_FONT = "12px -apple-system, sans-serif";
    const AXIS_COLOR = "#000000";

    // ---- X-диапазон (значения) ----
    const scaleMode = opts.scaleMode ?? "auto";
    const { useLog, logFallback } = resolveScale(
      scaleMode,
      state ? state.count : 0,
      state ? state.min : 0,
    );
    // Edge case 3.1: log запросили, но min <= 0 / count < 5.
    this.warnLogFallback(logFallback, scaleMode);

    let vMin = 0;
    let vMax = 1;
    let logMin = 0;
    let logMax = 1;

    if (state && state.count >= 5) {
      if (useLog) {
        logMin = Math.log10(state.min);
        logMax = Math.log10(state.max);
        const logSpan = logMax - logMin || 1;
        logMin -= logSpan * 0.03;
        logMax += logSpan * 0.03;
      } else {
        vMin = state.min;
        vMax = state.max;
        const span = vMax - vMin || 1;
        vMin -= span * 0.05;
        vMax += span * 0.05;
      }
    }

    const formatTick = (v: number): string => {
      if (useLog) {
        if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
        return v.toFixed(0);
      }
      return formatNumberPrecise(v, precision);
    };

    // ---- Отступы ----
    // Слева — повёрнутая подпись оси Y (категория), снизу — подписи
    // тиков, подпись оси X и прогресс-полоса.
    let padL = opts.yLabel ? 44 : 20;
    let padR = 20;

    const hasLegend = !!opts.legendText;
    const LEGEND_FONT = "11px -apple-system, sans-serif";
    const LEGEND_SWATCH = 11;
    const LEGEND_PAD = 8;
    const LEGEND_H = hasLegend ? 22 : 0;
    const LEGEND_GAP = hasLegend ? 6 : 0;

    const padT = 20 + LEGEND_H + LEGEND_GAP;
    const axisXLabelH = opts.xLabel ? 20 : 0;
    const padB = 12 + 16 + axisXLabelH + 20;

    // Крайние подписи тиков не должны обрезаться по краям канваса.
    if (showAxisLabels) {
      ctx.font = AXIS_FONT;
      const firstLabel = formatTick(useLog ? Math.pow(10, logMin) : vMin);
      const lastLabel = formatTick(useLog ? Math.pow(10, logMax) : vMax);
      padL = Math.max(padL, Math.ceil(ctx.measureText(firstLabel).width / 2) + 10);
      padR = Math.max(padR, Math.ceil(ctx.measureText(lastLabel).width / 2) + 10);
    }

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (plotW <= 10 || plotH <= 10) {
      this.hasData = false;
      return;
    }

    // Границы plot area — для клипа сырых точек и ромбика среднего.
    const plotClip = { x: padL, y: padT, w: plotW, h: plotH };

    // Значение → X-пиксель
    const valueToX = (v: number): number => {
      if (useLog) {
        const lv = Math.log10(Math.max(v, 1e-12));
        return padL + ((lv - logMin) / (logMax - logMin)) * plotW;
      }
      return padL + ((v - vMin) / (vMax - vMin)) * plotW;
    };

    // ---- Оси ----
    ctx.strokeStyle = "#c8cfd8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // ---- Плейсхолдер ----
    if (!state || state.count < 5) {
      this.hasData = false;
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        opts.placeholder ?? "Нужно минимум 5 числовых значений",
        padL + plotW / 2,
        padT + plotH / 2,
      );
      return;
    }

    // ---- X-тики ----
    const tickXPositions: number[] = [];
    const tickValues: number[] = [];

    for (let i = 0; i <= 5; ++i) {
      const t = i / 5;
      tickXPositions.push(padL + t * plotW);
      tickValues.push(
        useLog
          ? Math.pow(10, logMin + t * (logMax - logMin))
          : vMin + t * (vMax - vMin),
      );
    }

    if (showGrid) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (let i = 1; i < 5; ++i) {
        ctx.beginPath();
        ctx.moveTo(tickXPositions[i], padT);
        ctx.lineTo(tickXPositions[i], padT + plotH);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i <= 5; ++i) {
        ctx.fillText(formatTick(tickValues[i]), tickXPositions[i], padT + plotH + 6);
      }
    }

    // ---- Основные координаты ----
    const cy = padT + plotH / 2;
    const boxH = Math.min(plotH * 0.35, 160);

    const xQ1 = valueToX(state.q1);
    const xMed = valueToX(state.median);
    const xQ3 = valueToX(state.q3);

    const hasFences =
      typeof state.upperFence === "number" &&
      typeof state.lowerFence === "number";

    const upperWhiskerVal = hasFences
      ? Math.min(state.max, state.upperFence)
      : state.max;
    const lowerWhiskerVal = hasFences
      ? Math.max(state.min, state.lowerFence)
      : state.min;

    const xUpperWhisker = valueToX(upperWhiskerVal);
    const xLowerWhisker = valueToX(lowerWhiskerVal);

    const accent = "#4a9eff";
    const accentDark = "#2563eb";

    // Усы: от Q1 влево до нижнего уса и от Q3 вправо до верхнего
    ctx.strokeStyle = accentDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xLowerWhisker, cy);
    ctx.lineTo(xQ1, cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(xQ3, cy);
    ctx.lineTo(xUpperWhisker, cy);
    ctx.stroke();

    // Капы на концах усов (вертикальные)
    const capH = boxH * 0.4;
    ctx.beginPath();
    ctx.moveTo(xLowerWhisker, cy - capH / 2);
    ctx.lineTo(xLowerWhisker, cy + capH / 2);
    ctx.moveTo(xUpperWhisker, cy - capH / 2);
    ctx.lineTo(xUpperWhisker, cy + capH / 2);
    ctx.stroke();

    // Ящик Q1..Q3 (горизонтальный)
    const boxLeft = Math.min(xQ1, xQ3);
    const boxW = Math.max(1, Math.abs(xQ3 - xQ1));
    const gradient = ctx.createLinearGradient(boxLeft, 0, boxLeft + boxW, 0);
    gradient.addColorStop(0, "rgba(74, 158, 255, 0.08)");
    gradient.addColorStop(1, "rgba(74, 158, 255, 0.20)");

    // ---- Сырые точки (под ящиком) ----
    if (opts.showRawPoints === true && opts.rawData) {
      this.drawRawPoints(opts.rawData, {
        limit: state.processed,
        vertical: false,
        center: cy,
        jitterRange: boxH * 0.5,
        color: "rgba(37, 99, 235, 0.35)",
        toPos: valueToX,
        clip: plotClip,
        loFence: state.q1 - 1.5 * state.iqr,
        hiFence: state.q3 + 1.5 * state.iqr,
        maxPoints: MAX_RAW_POINTS,
      });
    }

    const xRight = boxLeft + boxW;
    const boxHalfH = boxH / 2;

    // Edge case 3.8: талия вертикальная — сужение по Y на уровне медианы по X.
    const notch = this.notchInsets(
      opts.notch === true,
      state.iqr,
      state.count,
      boxW,
      boxHalfH,
      Math.abs(xMed - boxLeft),
      Math.abs(xRight - xMed),
    );
    const drawNotch = notch.before > 0.5 && notch.after > 0.5;

    if (drawNotch) {
      const yTop = cy - boxHalfH;
      const yBottom = cy + boxHalfH;
      ctx.beginPath();
      ctx.moveTo(boxLeft, yTop);
      ctx.lineTo(xMed - notch.before, yTop);
      ctx.lineTo(xMed, yTop + notch.before);
      ctx.lineTo(xMed + notch.after, yTop);
      ctx.lineTo(xRight, yTop);
      ctx.lineTo(xRight, yBottom);
      ctx.lineTo(xMed + notch.after, yBottom);
      ctx.lineTo(xMed, yBottom - notch.after);
      ctx.lineTo(xMed - notch.before, yBottom);
      ctx.lineTo(boxLeft, yBottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = accentDark;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = gradient;
      ctx.fillRect(boxLeft, cy - boxHalfH, boxW, boxH);

      ctx.strokeStyle = accentDark;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        boxLeft + 0.5,
        cy - boxHalfH + 0.5,
        boxW - 1,
        boxH - 1,
      );
    }

    // Медиана (вертикальная линия)
    ctx.strokeStyle = accentDark;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(xMed, cy - boxH / 2);
    ctx.lineTo(xMed, cy + boxH / 2);
    ctx.stroke();

    // ---- Среднее (ромбик) ----
    if (
      opts.showMean === true &&
      state.count > 0 &&
      Number.isFinite(state.mean)
    ) {
      this.drawMeanMarker(valueToX(state.mean), cy, plotClip);
    }

    // ---- Выбросы ----
    // jitter теперь по вертикали: точки не «дрожат» между кадрами
    // благодаря детерминированной функции.
    const jitterRange = boxH * 0.5;
    const drawOutliers = (arr: number[]) => {
      if (!arr || arr.length === 0) return;
      ctx.fillStyle = accentDark;
      for (const v of arr) {
        const x = valueToX(v);
        const dy = outlierJitter(v, jitterRange);
        ctx.beginPath();
        ctx.arc(x, cy + dy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (state.done) {
      drawOutliers(state.upperOutliers);
      drawOutliers(state.lowerOutliers);
    }

    // ---- Подпись «+N скрытых» ----
    if (
      state.done &&
      state.upperOutlierCount > (state.upperOutliers?.length ?? 0)
    ) {
      const hidden = state.upperOutlierCount - state.upperOutliers.length;
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        `+${hidden.toLocaleString("ru-RU")} выбросов`,
        xUpperWhisker + 6,
        cy - boxH / 2 - 4,
      );
    }

    // ---- Легенда ----
    // try/catch: ошибка отрисовки легенды не должна крашить всю диаграмму.
    if (hasLegend && opts.legendText) {
      try {
        ctx.font = LEGEND_FONT;
        const textW = ctx.measureText(opts.legendText).width;
        const legendW = LEGEND_PAD * 2 + LEGEND_SWATCH + 6 + textW;
        const legendX = padL + plotW - legendW;
        const legendY = 8;

        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.strokeStyle = "#d8dde3";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === "function") {
          (ctx as any).roundRect(legendX, legendY, legendW, LEGEND_H, 4);
        } else {
          ctx.rect(legendX, legendY, legendW, LEGEND_H);
        }
        ctx.fill();
        ctx.stroke();

        const swatchY = legendY + (LEGEND_H - LEGEND_SWATCH) / 2;
        const swatchX = legendX + LEGEND_PAD;
        const swatchGrad = ctx.createLinearGradient(
          swatchX,
          0,
          swatchX + LEGEND_SWATCH,
          0,
        );
        swatchGrad.addColorStop(0, accent);
        swatchGrad.addColorStop(1, accentDark);
        ctx.fillStyle = swatchGrad;
        ctx.fillRect(swatchX, swatchY, LEGEND_SWATCH, LEGEND_SWATCH);
        ctx.strokeStyle = accentDark;
        ctx.strokeRect(
          swatchX + 0.5,
          swatchY + 0.5,
          LEGEND_SWATCH - 1,
          LEGEND_SWATCH - 1,
        );

        ctx.fillStyle = "#334155";
        ctx.font = LEGEND_FONT;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(
          opts.legendText,
          swatchX + LEGEND_SWATCH + 6,
          legendY + LEGEND_H / 2,
        );
      } catch (e) {
        console.error("[BoxPlotRenderer] Легенда (horizontal):", e);
      }
    }

    // ---- X-подпись (значения) ----
    if (opts.xLabel) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, padL + plotW / 2, H - 22);
    }

    // ---- Y-подпись (категория) ----
    if (opts.yLabel) {
      ctx.save();
      ctx.translate(12, padT + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }

    // ---- Прогресс-полоса ----
    const processed = opts.processed ?? state.processed ?? 0;
    const total = opts.total ?? state.total ?? 0;
    const progress = total > 0 ? processed / total : 0;

    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(padL, H - 3, plotW, 2);
    ctx.fillStyle = accent;
    ctx.fillRect(padL, H - 3, plotW * progress, 2);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${(progress * 100).toFixed(1)}% · ${processed.toLocaleString("ru-RU")} из ${total.toLocaleString("ru-RU")}`,
      padL + plotW,
      H - 6,
    );

    // ---- Σ — сумма отрисованных / общее число обработанных ----
    ctx.textAlign = "left";
    const sumText = `Σ ${state.count.toLocaleString("ru-RU")} / ${total.toLocaleString("ru-RU")}`;
    ctx.fillStyle = state.count === total ? "#16a34a" : "#dc2626";
    ctx.fillText(sumText, padL, H - 6);

    this.lastPlot = {
      padL,
      padT,
      plotW,
      plotH,
      vMin,
      vMax,
      result: state,
    };
    this.hasData = true;
  }

  hitTest(_mouseX: number, _mouseY: number): BoxPlotHitInfo | null {
    if (!this.hasData || !this.lastPlot) return null;
    const r = this.lastPlot.result;
    return {
      q1: r.q1,
      median: r.median,
      q3: r.q3,
      iqr: r.iqr,
      min: r.min,
      max: r.max,
      count: r.count,
      mean: r.mean,
    };
  }

  /**
   * Полуширины талии в пикселях.
   * Классика: медиана ± 1.58·IQR/√n. Edge case 3.6: ширина ограничена
   * (Q3−Q1)/2, иначе талия «выворачивает» ящик; плюс ограничение
   * свободным местом до Q1/Q3 и 45% полуширины ящика.
   * Edge case 3.7: IQR == 0 или count == 0 — талии нет.
   */
  private notchInsets(
    enabled: boolean,
    iqr: number,
    count: number,
    transversePx: number,
    boxHalfPx: number,
    spaceBefore: number,
    spaceAfter: number,
  ): { before: number; after: number } {
    if (!enabled || !(iqr > 0) || count <= 0) {
      return { before: 0, after: 0 };
    }
    const halfVal = Math.min((1.58 * iqr) / Math.sqrt(count), iqr / 2);
    const halfPx = Math.min((halfVal / iqr) * transversePx, boxHalfPx * 0.45);
    return {
      before: Math.min(halfPx, spaceBefore),
      after: Math.min(halfPx, spaceAfter),
    };
  }

  /**
   * Ромбик среднего. Вне plot area не рисуется (edge case 3.2).
   * Проверка Number.isFinite стоит до любой отрисовки: на лог-шкале
   * mean = 0 даёт log10(0) = -Infinity, а mean < 0 — NaN.
   */
  private drawMeanMarker(
    x: number,
    y: number,
    clip: { x: number; y: number; w: number; h: number },
    color = "#111827",
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < clip.x || x > clip.x + clip.w) return;
    if (y < clip.y || y > clip.y + clip.h) return;

    const ctx = this.ctx;
    const size = 5;
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Сырые точки под ящиком.
   * Edge case 3.3: не больше maxPoints — берём каждый k-й элемент
   * (детерминированно: иначе точки «мигают» на каждом кадре).
   * Edge case 3.4: выбросы пропускаем, они рисуются отдельным слоем.
   * Все точки — один path, один fill(): 2000 arc+fill вешают кадр.
   */
  private drawRawPoints(
    raw: Float64Array,
    opts: {
      limit: number;
      vertical: boolean;
      center: number;
      jitterRange: number;
      color: string;
      toPos: (v: number) => number;
      clip: { x: number; y: number; w: number; h: number };
      loFence: number;
      hiFence: number;
      maxPoints: number;
    },
  ): void {
    const total = Math.min(raw.length, Math.max(0, Math.floor(opts.limit)));
    if (total <= 0) return;

    const cap = Math.max(1, opts.maxPoints);
    const stride = Math.max(1, Math.ceil(total / cap));
    const ctx = this.ctx;

    ctx.save();
    ctx.beginPath();
    ctx.rect(opts.clip.x, opts.clip.y, opts.clip.w, opts.clip.h);
    ctx.clip();

    ctx.fillStyle = opts.color;
    ctx.beginPath();
    const r = 1.5;
    for (let i = 0; i < total; i += stride) {
      const v = raw[i];
      if (!Number.isFinite(v)) continue;
      if (v < opts.loFence || v > opts.hiFence) continue;
      const pos = opts.toPos(v);
      if (!Number.isFinite(pos)) continue;
      const off = outlierJitter(i + 1, opts.jitterRange);
      const x = opts.vertical ? opts.center + off : pos;
      const y = opts.vertical ? pos : opts.center + off;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  /** Однократное предупреждение о fallback лог-шкалы (edge case 3.1). */
  private warnLogFallback(fallback: boolean, scaleMode: string): void {
    if (!fallback) {
      this.logFallbackWarned = false;
      return;
    }
    if (this.logFallbackWarned) return;
    this.logFallbackWarned = true;
    console.warn(
      `[BoxPlotRenderer] scaleMode="${scaleMode}": логарифмическая шкала ` +
        `невозможна (min <= 0 или count < 5). Включена линейная шкала.`,
    );
  }
}

function formatNumberPrecise(x: number, precision: number): string {
  if (!isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a >= 1e9) return x.toExponential(1);
  const p = Math.max(0, Math.min(5, Math.floor(precision)));
  if (p === 0) return Math.round(x).toLocaleString("ru-RU");
  return x.toFixed(p);
}

/** Потолок сырых точек на один ящик. */
const MAX_RAW_POINTS = 2000;

/**
 * Разрешает режим шкалы.
 * "auto" — прежняя эвристика (count >= 5 && min > 0),
 * "linear"/"log" — принудительно; logFallback = log запрошен, но невозможен.
 */
function resolveScale(
  scaleMode: "auto" | "linear" | "log",
  count: number,
  min: number,
): { useLog: boolean; logFallback: boolean } {
  if (scaleMode === "linear") return { useLog: false, logFallback: false };
  if (scaleMode === "log") {
    const canLog = count >= 5 && min > 0;
    return { useLog: canLog, logFallback: !canLog };
  }
  return { useLog: count >= 5 && min > 0, logFallback: false };
}

/**
 * Детерминированный jitter для точки-выброса.
 * При одинаковом значении даёт одинаковое смещение — чтобы точки
 * не «прыгали» между кадрами при прогрессивной отрисовке.
 */
function outlierJitter(value: number, range: number): number {
  const h = Math.sin(value * 12.9898 + 4.1414) * 43758.5453;
  return (h - Math.floor(h) - 0.5) * range;
}

// HMR: модуль принимает сам себя, чтобы Vite не делал full reload.
// main.ts пересоздаёт рендереры живых карточек с новым модулем.
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (!mod) return;
    window.dispatchEvent(
      new CustomEvent("sift:renderer-updated", {
        detail: { type: "boxplot", module: mod },
      }),
    );
  });
}