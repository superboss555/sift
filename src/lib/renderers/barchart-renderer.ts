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
  accent?: string;
  placeholder?: string;
  topN?: number;
}

export class BarChartRenderer {
  private ctx: CanvasRenderingContext2D;

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

    const padL = 110;
    const padR = 24;
    const padT = 16;
    const padB = 44;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (plotW <= 10 || plotH <= 10) return;

    const accent = opts.accent ?? "#4a9eff";

    ctx.strokeStyle = "#c8cfd8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    if (!data || data.categories.length === 0) {
      this.drawPlaceholder(padL, padT, plotW, plotH, opts);
      return;
    }

    let cats = [...data.categories];
    cats.sort((a, b) => b.value - a.value);
    if (opts.topN && cats.length > opts.topN) {
      cats = cats.slice(0, opts.topN);
    }

    const maxVal = Math.max(1, ...cats.map((c) => c.value));

    const slotH = plotH / cats.length;
    const barH = Math.max(3, slotH - 4);

    ctx.font = "12px -apple-system, sans-serif";
    ctx.textBaseline = "middle";

    for (let i = 0; i < cats.length; ++i) {
      const c = cats[i];
      const barW = (c.value / maxVal) * plotW;
      const y = padT + i * slotH + (slotH - barH) / 2;

      ctx.fillStyle = "rgba(74, 158, 255, 0.85)";
      ctx.fillRect(padL, y, barW, barH);

      ctx.fillStyle = "#334155";
      ctx.textAlign = "right";
      ctx.fillText(this.truncate(c.label, 16), padL - 8, y + barH / 2);

      ctx.fillStyle = "#64748b";
      ctx.textAlign = "left";
      ctx.fillText(this.fmt(c.value), padL + barW + 6, y + barH / 2);
    }

    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.lineWidth = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#94a3b8";
    for (let i = 1; i <= 4; ++i) {
      const x = padL + (plotW * i) / 4;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillText(this.fmt((maxVal * i) / 4), x, padT + plotH + 4);
    }

    if (opts.xLabel) {
      ctx.fillStyle = "#64748b";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, padL + plotW / 2, H - 3);
    }
    if (opts.yLabel) {
      ctx.save();
      ctx.translate(14, padT + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#64748b";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }
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

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  private fmt(x: number): string {
    if (!isFinite(x)) return String(x);
    const a = Math.abs(x);
    if (a >= 1e6 || (a > 0 && a < 1e-3)) return x.toExponential(2);
    if (Number.isInteger(x)) return x.toLocaleString("ru-RU");
    return x.toFixed(2);
  }
}