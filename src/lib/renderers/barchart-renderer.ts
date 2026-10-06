export interface BarChartCategory {
  label: string;
  value: number;
}

export interface BarChartData {
  categories: BarChartCategory[];
  metricLabel: string;
}

export interface BarChartDrawOptions {
  xLabel?: string;
  yLabel?: string;
  legendText?: string;
  accent?: string;
  placeholder?: string;
  topN?: number;
  showGrid?: boolean;
  showAxisLabels?: boolean;
  preserveOrder?: boolean;
  precision?: number;
  /** Прогресс: сколько обработано из скольких. */
  processed?: number;
  total?: number;
  outOfBuckets?: number;
}

export interface BarChartHitInfo {
  label: string;
  value: number;
  percentage: number;
  rank: number;
}

export class BarChartRenderer {
  private ctx: CanvasRenderingContext2D;

  private lastPlot = {
    padL: 0,
    padT: 0,
    plotW: 0,
    plotH: 0,
    cats: [] as BarChartCategory[],
    maxVal: 0,
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

  draw(data: BarChartData | null, opts: BarChartDrawOptions = {}) {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    const showGrid = opts.showGrid !== false;
    const showAxisLabels = opts.showAxisLabels !== false;
    const precision = typeof opts.precision === "number" ? opts.precision : 0;

    const AXIS_FONT = "12px -apple-system, sans-serif";
    const AXIS_COLOR = "#000000";

    // ---- Отбор категорий ----
    let cats: BarChartCategory[] = [];
    if (data && data.categories.length > 0) {
      cats = [...data.categories];
      if (!opts.preserveOrder) {
        cats.sort((a, b) => b.value - a.value);
      }
      if (!opts.preserveOrder && opts.topN && cats.length > opts.topN) {
        cats = cats.slice(0, opts.topN);
      }
    }

    // ---- padL: полоса подписи оси Y + метки категорий ----
    const axisYLabelH = opts.yLabel ? 22 : 0;
    let padL = 60;
    if (showAxisLabels && cats.length > 0) {
      ctx.font = AXIS_FONT;
      let maxLabelW = 0;
      for (const c of cats) {
        const w = ctx.measureText(c.label).width;
        if (w > maxLabelW) maxLabelW = w;
      }
      padL = axisYLabelH + Math.ceil(maxLabelW) + 16;
      if (padL < 60) padL = 60;
    } else {
      padL = axisYLabelH + 40;
    }

    const padR = 18;

    // ---- Резерв места сверху под легенду ----
    const hasLegend = !!opts.legendText;
    const LEGEND_FONT = "11px -apple-system, sans-serif";
    const LEGEND_SWATCH = 11;
    const LEGEND_PAD = 8;
    const LEGEND_H = hasLegend ? 22 : 0;
    const LEGEND_GAP = hasLegend ? 6 : 0;

    const padT = 18 + LEGEND_H + LEGEND_GAP;

    const axisXLabelH = opts.xLabel ? 20 : 0;
     const padB = 12 + 14 + 6 + axisXLabelH + 10 + 12;

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (plotW <= 10 || plotH <= 10) {
      this.hasData = false;
      return;
    }

    const accent = opts.accent ?? "#4a9eff";
    const accentDark = "#2563eb";

    // Оси
    ctx.strokeStyle = "#c8cfd8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    if (!data || cats.length === 0) {
      this.hasData = false;
      this.drawPlaceholder(padL, padT, plotW, plotH, opts);
      return;
    }

    let maxVal = 0;
    for (const c of cats) if (c.value > maxVal) maxVal = c.value;
    if (maxVal === 0) maxVal = 1;

    const niceMax = niceCeil(maxVal);
    const total = cats.reduce((s, c) => s + c.value, 0);

    const slotH = plotH / cats.length;
    const barH = Math.max(4, slotH - 4);

    // ---- Сетка ----
    if (showGrid) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (let i = 1; i < 5; ++i) {
        const x = padL + (plotW * i) / 5;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ---- Столбики ----
    for (let i = 0; i < cats.length; ++i) {
      const c = cats[i];
      const barW = (c.value / niceMax) * plotW;
      const y = padT + i * slotH + (slotH - barH) / 2;

      const grad = ctx.createLinearGradient(padL, 0, padL + barW, 0);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, accentDark);
      ctx.fillStyle = grad;
      ctx.fillRect(padL, y, barW, barH);

      ctx.strokeStyle = accentDark;
      ctx.lineWidth = 1;
      ctx.strokeRect(padL + 0.5, y + 0.5, Math.max(0, barW - 1), barH - 1);
    }

    // ---- X-подписи (числовые тики частот) ----
    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i <= 5; ++i) {
        const x = padL + (plotW * i) / 5;
        const v = (niceMax * i) / 5;
        ctx.fillText(formatNumberPrecise(v, precision), x, padT + plotH + 12);
      }
    }

    // ---- Y-подписи (категории / диапазоны бинов) ----
    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      const maxVisible = Math.max(1, Math.floor(plotH / 18));
      const step = Math.max(1, Math.ceil(cats.length / maxVisible));

      for (let i = 0; i < cats.length; i += step) {
        const y = padT + i * slotH + slotH / 2;
        ctx.fillText(cats[i].label, padL - 8, y);
      }
    }

    // ---- Название оси X ----
    if (opts.xLabel) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, padL + plotW / 2, H - 22);
    }

    // ---- Название оси Y ----
    if (opts.yLabel) {
      const yLabelX = axisYLabelH / 2 - 1; // центр полосы
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

    // ---- Легенда (НАД plot area, не перекрывает данные) ----
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
        padL,
        0,
        padL + LEGEND_SWATCH,
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

    // ============================================================
    // Σ, полоса прогресса, процент
    // ============================================================
    const processed = opts.processed ?? total;
    const totalRows = opts.total ?? total;
    const progress = totalRows > 0 ? processed / totalRows : 0;

    // Полоса прогресса в самом низу
    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(padL, H - 3, plotW, 2);
    ctx.fillStyle = accent;
    ctx.fillRect(padL, H - 3, plotW * progress, 2);

    // Процент и processed/total — справа
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${(progress * 100).toFixed(1)}% · ${processed.toLocaleString("ru-RU")} из ${totalRows.toLocaleString("ru-RU")}`,
      padL + plotW,
      H - 6,
    );

    // Σ — сумма отрисованных / общее число обработанных — слева
    ctx.textAlign = "left";
    const sumText = `Σ ${total.toLocaleString("ru-RU")} / ${totalRows.toLocaleString("ru-RU")}`;
    ctx.fillStyle = total === totalRows ? "#16a34a" : "#dc2626";
    ctx.fillText(sumText, padL, H - 6);

    this.lastPlot = {
      padL,
      padT,
      plotW,
      plotH,
      cats,
      maxVal: niceMax,
      total,
    };
    this.hasData = true;
  }

  hitTest(mouseX: number, mouseY: number): BarChartHitInfo | null {
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

    const slotH = p.plotH / p.cats.length;
    const idx = Math.floor((mouseY - p.padT) / slotH);
    if (idx < 0 || idx >= p.cats.length) return null;

    const c = p.cats[idx];
    return {
      label: c.label,
      value: c.value,
      percentage: p.total > 0 ? c.value / p.total : 0,
      rank: idx + 1,
    };
  }

  private drawPlaceholder(
    padL: number,
    padT: number,
    plotW: number,
    plotH: number,
    opts: BarChartDrawOptions,
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

function formatNumberPrecise(x: number, precision: number): string {
  if (!isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a >= 1e9) return x.toExponential(1);
  const p = Math.max(0, Math.min(5, Math.floor(precision)));
  if (p === 0) return Math.round(x).toLocaleString("ru-RU");
  return x.toFixed(p);
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
