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
}

export interface BoxPlotHitInfo {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  count: number;
}

export class BoxPlotRenderer {
  private ctx: CanvasRenderingContext2D;
  private hasData = false;
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
    const useLog = !!(state && state.count >= 5 && state.min > 0);

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

    // Ящик Q1..Q3
    const gradient = ctx.createLinearGradient(0, yQ3, 0, yQ1);
    gradient.addColorStop(0, "rgba(74, 158, 255, 0.20)");
    gradient.addColorStop(1, "rgba(74, 158, 255, 0.08)");
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - boxWidth / 2, yQ3, boxWidth, yQ1 - yQ3);

    ctx.strokeStyle = accentDark;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      cx - boxWidth / 2 + 0.5,
      yQ3 + 0.5,
      boxWidth - 1,
      yQ1 - yQ3 - 1,
    );

    // Медиана
    ctx.strokeStyle = accentDark;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - boxWidth / 2, yMed);
    ctx.lineTo(cx + boxWidth / 2, yMed);
    ctx.stroke();

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
    if (hasLegend && opts.legendText) {
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
    };
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

/**
 * Детерминированный jitter для точки-выброса.
 * При одинаковом значении даёт одинаковое смещение — чтобы точки
 * не «прыгали» между кадрами при прогрессивной отрисовке.
 */
function outlierJitter(value: number, range: number): number {
  const h = Math.sin(value * 12.9898 + 4.1414) * 43758.5453;
  return (h - Math.floor(h) - 0.5) * range;
}