import type { HistogramChunkResult } from "../sift-core.js";

export interface HistogramDrawOptions {
  xLabel?: string;
  yLabel?: string;
  /** Текст легенды: показывается в углу, описывает что за данные. */
  legendText?: string;
  accent?: string;
  placeholder?: string;
  showGrid?: boolean;
  showAxisLabels?: boolean;
  binLabels?: string[];
  /** Знаков после запятой в подписях. 0 = целые. */
  precision?: number;
}

export interface HistogramHitInfo {
  binIndex: number;
  count: number;
  rangeStart: number;
  rangeEnd: number;
  frequency: number;
  total: number;
}

export class HistogramRenderer {
  private ctx: CanvasRenderingContext2D;

  private lastPlot = {
    padL: 0,
    padT: 0,
    plotW: 0,
    plotH: 0,
    bins: 0,
    min: 0,
    max: 0,
    maxCount: 0,
    counts: [] as number[],
    total: 0,
  };
  private hasData = false;

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

  draw(state: HistogramChunkResult | null, opts: HistogramDrawOptions = {}) {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    const showGrid = opts.showGrid !== false;
    const showAxisLabels = opts.showAxisLabels !== false;
    const precision = typeof opts.precision === "number" ? opts.precision : 0;

    const AXIS_FONT = "12px -apple-system, sans-serif";
    const AXIS_COLOR = "#000000";

    // ============================================================
    // РАСЧЁТ ГРАНИЦ — до всего остального
    // ============================================================

    // ---- Y-подписи: считаем padL ----
    let niceMax = 1;
    if (state && state.counts.length > 0) {
      let maxCount = 0;
      for (const c of state.counts) if (c > maxCount) maxCount = c;
      if (maxCount === 0) maxCount = 1;
      niceMax = niceCeil(maxCount);
    }

    let padL = 52;
    if (showAxisLabels) {
      ctx.font = AXIS_FONT;
      let maxYLabelW = 0;
      for (let i = 0; i <= 5; ++i) {
        const v = niceMax * (i / 5);
        const w = ctx.measureText(formatNumberPrecise(v, precision)).width;
        if (w > maxYLabelW) maxYLabelW = w;
      }
      // 14px — полоса под вертикальную подпись оси Y
      // 8px — зазор до меток
      padL = Math.max(52, 14 + Math.ceil(maxYLabelW) + 16);
    }

    const padR = 18;

    // ---- Резерв места сверху под легенду ----
    // Легенда рисуется НАД plot area, чтобы не перекрывать данные.
    // Если легенда не задана — отступ остаётся прежним (18).
    const hasLegend = !!opts.legendText;
    const legendFont = "11px -apple-system, sans-serif";
    const legendSwatchSize = 11;
    const legendPad = 8;
    const legendH = hasLegend ? 22 : 0;
    const legendGap = hasLegend ? 6 : 0;

    const padT = 18 + legendH + legendGap;

    // ---- X-подписи: бины + подпись оси X ----
    const hasBinLabels =
      showAxisLabels && !!opts.binLabels && opts.binLabels.length > 0;

    let binLabelH = 0; // длина вертикальной метки бина (после поворота)
    if (hasBinLabels) {
      ctx.font = AXIS_FONT;
      let maxLabelW = 0;
      for (const lb of opts.binLabels!) {
        const w = ctx.measureText(lb).width;
        if (w > maxLabelW) maxLabelW = w;
      }
      binLabelH = Math.ceil(maxLabelW);
    }

    const axisXLabelH = opts.xLabel ? 20 : 0;

    // Зазор между бинами и подписью оси X.
    // Пока бины показываются, между ними и подписью нужно минимум
    // 20px, чтобы вертикальные метки бинов не касались названия оси.
    const BIN_AXIS_GAP = showAxisLabels && binLabelH > 0 ? 20 : 6;

    // padB = верхний зазор (6)
    //      + длина вертикальных меток (binLabelH)
    //      + зазор между бинами и осью X
    //      + подпись оси X (axisXLabelH)
    //      + нижний отступ (6)
    let padB: number;
    if (showAxisLabels) {
      padB = 6 + binLabelH + BIN_AXIS_GAP + axisXLabelH + 6;
      if (padB < 26) padB = 26;
    } else {
      padB = 26;
    }

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (plotW <= 10 || plotH <= 10) {
      this.hasData = false;
      return;
    }

    const accent = opts.accent ?? "#4a9eff";
    const accentDark = "#2563eb";

    // ============================================================
    // ОСИ И ПЛЕЙСХОЛДЕР
    // ============================================================

    ctx.strokeStyle = "#c8cfd8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    if (!state || state.counts.length === 0) {
      this.hasData = false;
      this.drawPlaceholder(padL, padT, plotW, plotH, opts);
      return;
    }

    const counts = state.counts;
    const n = counts.length;
    // niceMax — из блока «РАСЧЁТ ГРАНИЦ»

    // ---- Сетка ----
    if (showGrid) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (let i = 1; i < 5; ++i) {
        const y = padT + plotH - (i / 5) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ---- Y-подписи ----
    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 5; ++i) {
        const t = i / 5;
        const y = padT + plotH - t * plotH;
        const v = niceMax * t;
        ctx.fillText(formatNumberPrecise(v, precision), padL - 8, y);
      }
    }

    // ---- Столбики ----
    const slotW = plotW / n;
    const barW = Math.max(1, slotW - 1);

    for (let i = 0; i < n; ++i) {
      const h = (counts[i] / niceMax) * plotH;
      if (h <= 0) continue;

      const x = padL + i * slotW + 0.5;
      const y = padT + plotH - h;

      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, accentDark);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, h);

      ctx.strokeStyle = accentDark;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, barW - 1, Math.max(0, h - 1));
    }

    // ---- X-подписи: вертикальные, крупные, чёрные ----
    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      if (opts.binLabels && opts.binLabels.length === n) {
        const step = Math.max(1, Math.ceil(n / 15));
        for (let i = 0; i < n; i += step) {
          const x = padL + (i + 0.5) * slotW;
          ctx.save();
          ctx.translate(x, padT + plotH + 6);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(opts.binLabels[i], 0, 0);
          ctx.restore();
        }
      } else {
        for (let i = 0; i <= 5; ++i) {
          const t = i / 5;
          const x = padL + t * plotW;
          const v = state.min + t * (state.max - state.min);
          ctx.save();
          ctx.translate(x, padT + plotH + 6);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(formatNumberPrecise(v, precision), 0, 0);
          ctx.restore();
        }
      }
    }

    // ---- Название оси X ----
    // Поднимаем на 22px, чтобы не пересекаться с Σ и ⚠ внизу
    if (opts.xLabel) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, padL + plotW / 2, H - 22);
    }

    // ---- Название оси Y ----
    if (opts.yLabel) {
      // Полоса под вертикальную подпись = 14px от левого края
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

    // ---- Легенда (рисуется НАД plot area, не перекрывает данные) ----
    if (opts.legendText && hasLegend) {
      ctx.font = legendFont;
      const textW = ctx.measureText(opts.legendText).width;
      const legendW = legendPad * 2 + legendSwatchSize + 6 + textW;
      // Выравниваем легенду по правому краю plot area
      const legendX = padL + plotW - legendW;
      const legendY = 8; // верх canvas, над plot area

      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.strokeStyle = "#d8dde3";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof (ctx as any).roundRect === "function") {
        (ctx as any).roundRect(legendX, legendY, legendW, legendH, 4);
      } else {
        ctx.rect(legendX, legendY, legendW, legendH);
      }
      ctx.fill();
      ctx.stroke();

      const swatchY = legendY + (legendH - legendSwatchSize) / 2;
      const swatchX = legendX + legendPad;
      const swatchGrad = ctx.createLinearGradient(
        0,
        swatchY,
        0,
        swatchY + legendSwatchSize,
      );
      swatchGrad.addColorStop(0, accent);
      swatchGrad.addColorStop(1, accentDark);
      ctx.fillStyle = swatchGrad;
      ctx.fillRect(swatchX, swatchY, legendSwatchSize, legendSwatchSize);
      ctx.strokeStyle = accentDark;
      ctx.strokeRect(
        swatchX + 0.5,
        swatchY + 0.5,
        legendSwatchSize - 1,
        legendSwatchSize - 1,
      );

      ctx.fillStyle = "#334155";
      ctx.font = legendFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(
        opts.legendText,
        swatchX + legendSwatchSize + 6,
        legendY + legendH / 2,
      );
    }

    // ---- Σ и прогресс ----
    let sumCounts = 0;
    for (const c of counts) sumCounts += c;

    const progress = state.total > 0 ? state.processed / state.total : 0;
    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(padL, H - 3, plotW, 2);
    ctx.fillStyle = accent;
    ctx.fillRect(padL, H - 3, plotW * progress, 2);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${(progress * 100).toFixed(1)}% · ${state.processed.toLocaleString("ru-RU")} из ${state.total.toLocaleString("ru-RU")}`,
      padL + plotW,
      H - 6,
    );

    ctx.textAlign = "left";
    const sumText = `Σ ${sumCounts.toLocaleString("ru-RU")} / ${state.total.toLocaleString("ru-RU")}`;
    ctx.fillStyle = sumCounts === state.total ? "#16a34a" : "#dc2626";
    ctx.fillText(sumText, padL, H - 6);

    this.lastPlot = {
      padL,
      padT,
      plotW,
      plotH,
      bins: n,
      min: state.min,
      max: state.max,
      maxCount: niceMax,
      counts,
      total: state.total,
    };
    this.hasData = true;
  }

  hitTest(mouseX: number, mouseY: number): HistogramHitInfo | null {
    if (!this.hasData) return null;
    const p = this.lastPlot;
    if (
      mouseX < p.padL ||
      mouseX > p.padL + p.plotW ||
      mouseY < p.padT ||
      mouseY > p.padT + p.plotH
    ) {
      return null;
    }
    const slotW = p.plotW / p.bins;
    const rawIdx = Math.floor((mouseX - p.padL) / slotW);
    const binIndex = Math.min(p.bins - 1, Math.max(0, rawIdx));
    const count = p.counts[binIndex] ?? 0;
    const binWidth = (p.max - p.min) / p.bins;
    const rangeStart = p.min + binIndex * binWidth;
    const rangeEnd = rangeStart + binWidth;

    // Знаменатель для «доли» — сумма всех отрисованных бинов,
    // а НЕ state.total. Так значения, попавшие «вне диапазона»
    // (underflow/overflow для bucketed histogram), не размывают долю.
    // Это согласовано с BarChartRenderer.
    let sumCounts = 0;
    for (const c of p.counts) sumCounts += c;

    return {
      binIndex,
      count,
      rangeStart,
      rangeEnd,
      frequency: sumCounts > 0 ? count / sumCounts : 0,
      total: sumCounts,
    };
  }

  private drawPlaceholder(
    padL: number,
    padT: number,
    plotW: number,
    plotH: number,
    opts: HistogramDrawOptions,
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "13px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      opts.placeholder ?? "Нет данных",
      padL + plotW / 2,
      padT + plotH / 2,
    );
  }
}

function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const m = x / base;
  let nice: number;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

/**
 * Формат числа с настраиваемой точностью.
 * precision = 0 → целое с разделителем разрядов
 * precision 1..5 → фиксированное кол-во знаков после точки
 */
export function formatNumberPrecise(x: number, precision: number): string {
  if (!isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a >= 1e9) return x.toExponential(1);
  const p = Math.max(0, Math.min(5, Math.floor(precision)));
  if (p === 0) return Math.round(x).toLocaleString("ru-RU");
  return x.toFixed(p);
}
