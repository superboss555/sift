import type { HistogramChunkResult } from "../sift-core.js";

export interface HistogramDrawOptions {
  xLabel?: string;
  yLabel?: string;
  accent?: string;
  placeholder?: string;
  showGrid?: boolean;
  showAxisLabels?: boolean;
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

  // Кэш последней отрисовки — для hitTest
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

    const padL = 52;
    const padR = 18;
    const padT = 18;
    const padB = 52;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (plotW <= 10 || plotH <= 10) {
      this.hasData = false;
      return;
    }

    const accent = opts.accent ?? "#4a9eff";
    const accentDark = "#2563eb";
    const showGrid = opts.showGrid !== false;
    const showAxisLabels = opts.showAxisLabels !== false;

    // Оси
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

    let maxCount = 0;
    for (const c of counts) if (c > maxCount) maxCount = c;
    if (maxCount === 0) maxCount = 1;

    // Округляем верх шкалы Y до «красивого» числа
    const niceMax = niceCeil(maxCount);

    // Горизонтальные линии сетки
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

    // Подписи на оси Y
    if (showAxisLabels) {
      ctx.fillStyle = "#64748b";
      ctx.font = "11px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 5; ++i) {
        const t = i / 5;
        const y = padT + plotH - t * plotH;
        const v = niceMax * t;
        ctx.fillText(formatNumber(v), padL - 8, y);
      }
    }

    // Столбики
    const slotW = plotW / n;
    const barW = Math.max(1, slotW - 1);

    for (let i = 0; i < n; ++i) {
      const h = (counts[i] / niceMax) * plotH;
      if (h <= 0) continue;

      const x = padL + i * slotW + 0.5;
      const y = padT + plotH - h;

      // Градиент по высоте столбика
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, accentDark);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, h);

      // Обводка
      ctx.strokeStyle = accentDark;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, barW - 1, Math.max(0, h - 1));
    }

    // Подписи на оси X
    if (showAxisLabels) {
      ctx.fillStyle = "#64748b";
      ctx.font = "11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i <= 5; ++i) {
        const t = i / 5;
        const x = padL + t * plotW;
        const v = state.min + t * (state.max - state.min);
        ctx.fillText(formatNumber(v), x, padT + plotH + 6);
      }
    }

    // Названия осей (из легенды)
    if (opts.xLabel) {
      ctx.fillStyle = "#475569";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, padL + plotW / 2, H - 4);
    }
    if (opts.yLabel) {
      ctx.save();
      ctx.translate(14, padT + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#475569";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }

        // Сумма столбиков (то, что реально нарисовано) vs обработано
    let sumCounts = 0;
    for (const c of counts) sumCounts += c;

    // Полоса прогресса
    const progress = state.total > 0 ? state.processed / state.total : 0;
    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(padL, H - 3, plotW, 2);
    ctx.fillStyle = accent;
    ctx.fillRect(padL, H - 3, plotW * progress, 2);

    // Подпись справа: Σ нарисованного / обработанного
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${(progress * 100).toFixed(1)}% · ${state.processed.toLocaleString("ru-RU")} из ${state.total.toLocaleString("ru-RU")}`,
      padL + plotW,
      H - 6,
    );

    // Σ — сумма столбиков против total
    ctx.textAlign = "left";
    const sumText = `Σ ${sumCounts.toLocaleString("ru-RU")} / ${state.total.toLocaleString("ru-RU")}`;
    ctx.fillStyle = sumCounts === state.total ? "#16a34a" : "#dc2626";
    ctx.fillText(sumText, padL, H - 6);

    // Индикатор underflow / overflow, если что-то потеряно
    const overflowCount = state.overflow ?? 0;
    const underflowCount = state.underflow ?? 0;
    if (overflowCount > 0 || underflowCount > 0) {
      const lost = overflowCount + underflowCount;
      const warn = `⚠ вне диапазона: ${lost}`;
      ctx.fillStyle = "#dc2626";
      ctx.textAlign = "center";
      ctx.fillText(warn, padL + plotW / 2, H - 6);
    }

    // Кэшируем для hitTest
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

  /** Возвращает информацию о бине под курсором (координаты в CSS-пикселях отн. canvas). */
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
    return {
      binIndex,
      count,
      rangeStart,
      rangeEnd,
      frequency: p.total > 0 ? count / p.total : 0,
      total: p.total,
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

/** Округляет число вверх до «красивого»: 1/2/5 × 10^k. */
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

function formatNumber(x: number): string {
  if (!isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a >= 1e6 || (a > 0 && a < 1e-3)) return x.toExponential(1);
  if (Number.isInteger(x)) return x.toLocaleString("ru-RU");
  if (a >= 100) return x.toFixed(0);
  if (a >= 10) return x.toFixed(1);
  return x.toFixed(2);
}