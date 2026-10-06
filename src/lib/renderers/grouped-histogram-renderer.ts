import type { GroupedHistogramChunkResult } from "../sift-core.js";
import { formatNumberPrecise } from "./histogram-renderer.js";

export interface GroupedHistogramDrawOptions {
  xLabel?: string;
  yLabel?: string;
  showGrid?: boolean;
  showAxisLabels?: boolean;
  /** Рисовать ли легенду серий. Имена серий при этом всё равно
   *  передаются в `seriesNames` — они нужны для tooltip. */
  showLegend?: boolean;
  precision?: number;
  renderMode: "grouped" | "stacked";
  seriesNames: string[];
  binLabels: string[];
  placeholder?: string;
}

export interface GroupedHistogramHitInfo {
  bucketIndex: number;
  categoryIndex: number;
  value: number;
  bucketLabel: string;
  seriesName: string;
}

export class GroupedHistogramRenderer {
  private ctx: CanvasRenderingContext2D;
  private hasData = false;
  private lastPlot: any = null;

  // Палитра цветов (можно вынести в конфиг)
  private readonly PALETTE = [
    "#4a9eff", "#f59e0b", "#10b981", "#ef4444", 
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"
  ];

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

  draw(state: GroupedHistogramChunkResult | null, opts: GroupedHistogramDrawOptions) {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    const showGrid = opts.showGrid !== false;
    const showAxisLabels = opts.showAxisLabels !== false;
    const precision = opts.precision ?? 0;
    const AXIS_FONT = "12px -apple-system, sans-serif";
    const AXIS_COLOR = "#000000";

     let niceMax = 1;
    if (state && state.counts.length > 0) {
      let maxVal = 0;
      if (opts.renderMode === "grouped") {
        for (const c of state.counts) if (c > maxVal) maxVal = c;
      } else {
        for (let b = 0; b < state.numBuckets; b++) {
          let sum = 0;
          for (let c = 0; c < state.numCategories; c++) {
            sum += state.counts[b * state.numCategories + c];
          }
          if (sum > maxVal) maxVal = sum;
        }
      }
      niceMax = this.niceCeil(maxVal);
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
      padL = Math.max(52, 14 + Math.ceil(maxYLabelW) + 16);
    }

    const padR = 18;
    const padT = 18;
    const axisXLabelH = opts.xLabel ? 20 : 0;
    
    // Нижний отступ
    let binLabelH = 0;
    if (showAxisLabels && opts.binLabels.length > 0) {
      ctx.font = AXIS_FONT;
      let maxLabelW = 0;
      for (const lb of opts.binLabels) {
        const w = ctx.measureText(lb).width;
        if (w > maxLabelW) maxLabelW = w;
      }
      binLabelH = Math.ceil(maxLabelW);
    }
    const BIN_AXIS_GAP = showAxisLabels && binLabelH > 0 ? 20 : 6;
    const padB = 6 + binLabelH + BIN_AXIS_GAP + axisXLabelH + 6 + 12; // +12 для прогресс-бара

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (plotW <= 10 || plotH <= 10) {
      this.hasData = false;
      return;
    }

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
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.placeholder ?? "Нет данных", padL + plotW / 2, padT + plotH / 2);
      return;
    }

    const n = state.numBuckets;
    const nCats = state.numCategories;
    const slotW = plotW / n;

    // Фоновая полоса для каждой группы — визуально отделяет их друг
    // от друга. Рисуется ДО столбиков и сетки.
    const slotGap = Math.min(slotW * 0.25, 32);
    const slotInner = slotW - slotGap;
    for (let b = 0; b < n; ++b) {
      const x0 = padL + b * slotW + slotGap / 2;
      ctx.fillStyle =
        b % 2 === 0
          ? "rgba(148, 163, 184, 0.06)"
          : "rgba(148, 163, 184, 0.12)";
      ctx.fillRect(x0, padT, slotInner, plotH);
    }

    // Сетка
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

    // Y-подписи
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

    // === ОТРИСОВКА СТОЛБИКОВ ===
    //
    // В режиме grouped делим слот на nCats равных подстолбиков,
    // внутри подстолбика оставляем 1px зазор.
    // Зазор между группами = slotGap (тот же, что для фоновых полос).
    const subBarW = slotInner / nCats;
    const groupStartOffset = slotGap / 2;

    for (let b = 0; b < n; ++b) {
      const xBase = padL + b * slotW;

      if (opts.renderMode === "grouped") {
        for (let c = 0; c < nCats; ++c) {
          const val = state.counts[b * nCats + c];
          const h = (val / niceMax) * plotH;
          if (h <= 0) continue;

          const x = xBase + groupStartOffset + c * subBarW;
          const y = padT + plotH - h;

          ctx.fillStyle = this.PALETTE[c % this.PALETTE.length];
          ctx.fillRect(x, y, Math.max(1, subBarW - 1), h);
        }
      } else {
        // Stacked — один столбик на всю внутреннюю ширину слота
        let currentY = padT + plotH;
        const barW = Math.max(1, slotInner);

        for (let c = 0; c < nCats; ++c) {
          const val = state.counts[b * nCats + c];
          const h = (val / niceMax) * plotH;
          if (h <= 0) continue;

          currentY -= h;
          ctx.fillStyle = this.PALETTE[c % this.PALETTE.length];
          ctx.fillRect(xBase + groupStartOffset, currentY, barW, h);
        }
      }
    }

    // X-подписи (вертикальные)
    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const step = Math.max(1, Math.ceil(n / 15));
      for (let i = 0; i < n; i += step) {
        const x = padL + (i + 0.5) * slotW;
        ctx.save();
        ctx.translate(x, padT + plotH + 6);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(opts.binLabels[i] || `bin ${i}`, 0, 0);
        ctx.restore();
      }
    }

    // Название оси X
    if (opts.xLabel) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, padL + plotW / 2, H - 22);
    }

    // Название оси Y
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

    // Легенда серий (сверху справа)
    if (opts.showLegend !== false && opts.seriesNames.length > 0) {
      const legendFont = "11px -apple-system, sans-serif";
      ctx.font = legendFont;
      const legendH = opts.seriesNames.length * 16 + 10;
      let legendW = 0;
      for (const s of opts.seriesNames) {
        const w = ctx.measureText(s).width + 20;
        if (w > legendW) legendW = w;
      }
      
      const legendX = padL + plotW - legendW - 6;
      const legendY = padT + 6;
      
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

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (let i = 0; i < opts.seriesNames.length; i++) {
        const y = legendY + 10 + i * 16;
        ctx.fillStyle = this.PALETTE[i % this.PALETTE.length];
        ctx.fillRect(legendX + 6, y - 4, 8, 8);
        ctx.fillStyle = "#334155";
        ctx.fillText(opts.seriesNames[i], legendX + 18, y);
      }
    }

    // Прогресс-бар
    const progress = state.total > 0 ? state.processed / state.total : 0;
    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(padL, H - 3, plotW, 2);
    ctx.fillStyle = "#4a9eff";
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

    // Σ — сумма отрисованных / общее число обработанных — слева
    let sumCounts = 0;
    for (const c of state.counts) sumCounts += c;
    ctx.textAlign = "left";
    const sumText = `Σ ${sumCounts.toLocaleString("ru-RU")} / ${state.total.toLocaleString("ru-RU")}`;
    ctx.fillStyle = sumCounts === state.total ? "#16a34a" : "#dc2626";
    ctx.fillText(sumText, padL, H - 6);

    this.hasData = true;
    this.lastPlot = {
      padL, padT, plotW, plotH, n, nCats, niceMax, slotW,
      slotGap,
      subBarW,
      groupStartOffset,
      counts: state.counts,
      binLabels: opts.binLabels,
      seriesNames: opts.seriesNames,
      renderMode: opts.renderMode,
    };
  }

  hitTest(mouseX: number, mouseY: number): GroupedHistogramHitInfo | null {
    if (!this.hasData || !this.lastPlot) return null;
    const p = this.lastPlot;

    if (
      mouseX < p.padL ||
      mouseX > p.padL + p.plotW ||
      mouseY < p.padT ||
      mouseY > p.padT + p.plotH
    ) {
      return null;
    }

    const relX = mouseX - p.padL;
    const bIdx = Math.max(0, Math.min(p.n - 1, Math.floor(relX / p.slotW)));
    const binLabel = p.binLabels?.[bIdx] ?? "";

    if (p.renderMode === "grouped") {
      // Внутри слота — nCats подстолбиков, сдвинутых вправо на groupStartOffset.
      const relXInSlot =
        relX - bIdx * p.slotW - (p.groupStartOffset ?? 0);

      // Курсор попал в зазор между группами — прячем tooltip.
      if (relXInSlot < 0 || relXInSlot >= p.subBarW * p.nCats) {
        return null;
      }

      const cIdx = Math.max(
        0,
        Math.min(p.nCats - 1, Math.floor(relXInSlot / p.subBarW)),
      );
      const val = p.counts[bIdx * p.nCats + cIdx];
      return {
        bucketIndex: bIdx,
        categoryIndex: cIdx,
        value: val,
        bucketLabel: binLabel,
        seriesName: p.seriesNames[cIdx] ?? `серия ${cIdx + 1}`,
      };
    }

    // Stacked — нужно определить сегмент по Y
    const stackVals: number[] = [];
    let sum = 0;
    for (let c = 0; c < p.nCats; ++c) {
      const v = p.counts[bIdx * p.nCats + c];
      stackVals.push(v);
      sum += v;
    }
    if (sum === 0) return null;

    const totalH = (sum / p.niceMax) * p.plotH;
    const yFromBottom = p.padT + p.plotH - mouseY;
    if (yFromBottom < 0 || yFromBottom > totalH) return null;

    let cum = 0;
    for (let c = 0; c < p.nCats; ++c) {
      const segH = (stackVals[c] / sum) * totalH;
      if (yFromBottom >= cum && yFromBottom < cum + segH) {
        return {
          bucketIndex: bIdx,
          categoryIndex: c,
          value: stackVals[c],
          bucketLabel: binLabel,
          seriesName: p.seriesNames[c] ?? `серия ${c + 1}`,
        };
      }
      cum += segH;
    }
    return null;
  }

  private niceCeil(x: number): number {
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
}