import type { GroupedHistogramChunkResult } from "../sift-core.js";
import { formatNumberPrecise } from "./histogram-renderer.js";

export interface GroupedBarChartDrawOptions {
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

export interface GroupedBarChartHitInfo {
  bucketIndex: number;
  categoryIndex: number;
  value: number;
  bucketLabel: string;
  seriesName: string;
}

export class GroupedBarChartRenderer {
  private ctx: CanvasRenderingContext2D;
  private hasData = false;
  private lastPlot: any = null;

  private readonly PALETTE = [
    "#4a9eff", "#f59e0b", "#10b981", "#ef4444",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
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

  draw(state: GroupedHistogramChunkResult | null, opts: GroupedBarChartDrawOptions) {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    const showGrid = opts.showGrid !== false;
    const showAxisLabels = opts.showAxisLabels !== false;
    const precision = opts.precision ?? 0;
    const AXIS_FONT = "12px -apple-system, sans-serif";
    const AXIS_COLOR = "#000000";

    // niceMax по X (частотам)
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

    // padL — слева метки бинов + подпись оси Y
    let padL = 60;
    if (showAxisLabels && opts.binLabels.length > 0) {
      ctx.font = AXIS_FONT;
      let maxLabelW = 0;
      for (const lb of opts.binLabels) {
        const w = ctx.measureText(lb).width;
        if (w > maxLabelW) maxLabelW = w;
      }
      padL = Math.max(60, 14 + Math.ceil(maxLabelW) + 16);
    }

    const padR = 18;

    // ---- Резерв места сверху под легенду серий ----
    const hasSeries =
      opts.showLegend !== false && opts.seriesNames.length > 0;
    const LEGEND_FONT = "11px -apple-system, sans-serif";
    const LEGEND_H = hasSeries ? opts.seriesNames.length * 16 + 10 : 0;
    const LEGEND_GAP = hasSeries ? 6 : 0;

    const padT = 18 + LEGEND_H + LEGEND_GAP;
    const axisXLabelH = opts.xLabel ? 20 : 0;
    // Снизу — тики X + название оси + прогресс-бар
    const padB = 6 + 14 + 6 + axisXLabelH + 6 + 12;

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
      ctx.fillText(
        opts.placeholder ?? "Нет данных",
        padL + plotW / 2,
        padT + plotH / 2,
      );
      return;
    }

    const n = state.numBuckets;
    const nCats = state.numCategories;
    const slotH = plotH / n;

    // Фоновые полосы для групп
    const slotGap = Math.min(slotH * 0.25, 32);
    const slotInner = slotH - slotGap;
    for (let b = 0; b < n; ++b) {
      const y0 = padT + b * slotH + slotGap / 2;
      ctx.fillStyle =
        b % 2 === 0
          ? "rgba(148, 163, 184, 0.06)"
          : "rgba(148, 163, 184, 0.12)";
      ctx.fillRect(padL, y0, plotW, slotInner);
    }

    // Сетка (вертикальная)
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

    // X-подписи (частоты)
    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i <= 5; ++i) {
        const x = padL + (plotW * i) / 5;
        const v = (niceMax * i) / 5;
        ctx.fillText(formatNumberPrecise(v, precision), x, padT + plotH + 6);
      }
    }

    // Y-подписи (метки бинов)
    if (showAxisLabels) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = AXIS_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const maxVisible = Math.max(1, Math.floor(plotH / 18));
      const step = Math.max(1, Math.ceil(n / maxVisible));
      for (let i = 0; i < n; i += step) {
        const y = padT + i * slotH + slotH / 2;
        ctx.fillText(opts.binLabels[i] || `bin ${i}`, padL - 8, y);
      }
    }

    // === СТОЛБИКИ ===
    const subBarH = slotInner / nCats;
    const groupStartOffset = slotGap / 2;

    for (let b = 0; b < n; ++b) {
      const yBase = padT + b * slotH;

      if (opts.renderMode === "grouped") {
        for (let c = 0; c < nCats; ++c) {
          const val = state.counts[b * nCats + c];
          const w = (val / niceMax) * plotW;
          if (w <= 0) continue;
          const y = yBase + groupStartOffset + c * subBarH;
          ctx.fillStyle = this.PALETTE[c % this.PALETTE.length];
          ctx.fillRect(padL, y, w, Math.max(1, subBarH - 1));
        }
      } else {
        // Stacked — один столбик на всю высоту слота, растёт вправо
        let currentX = padL;
        const barH = Math.max(1, slotInner);
        for (let c = 0; c < nCats; ++c) {
          const val = state.counts[b * nCats + c];
          const w = (val / niceMax) * plotW;
          if (w <= 0) continue;
          ctx.fillStyle = this.PALETTE[c % this.PALETTE.length];
          ctx.fillRect(currentX, yBase + groupStartOffset, w, barH);
          currentX += w;
        }
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

    // Легенда серий — НАД plot area, не перекрывает данные
    if (hasSeries) {
      ctx.font = LEGEND_FONT;
      let legendW = 0;
      for (const s of opts.seriesNames) {
        const w = ctx.measureText(s).width + 20;
        if (w > legendW) legendW = w;
      }
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

    // Σ
    let sumCounts = 0;
    for (const c of state.counts) sumCounts += c;
    ctx.textAlign = "left";
    const sumText = `Σ ${sumCounts.toLocaleString("ru-RU")} / ${state.total.toLocaleString("ru-RU")}`;
    ctx.fillStyle = sumCounts === state.total ? "#16a34a" : "#dc2626";
    ctx.fillText(sumText, padL, H - 6);

    this.hasData = true;
    this.lastPlot = {
      padL, padT, plotW, plotH, n, nCats, niceMax, slotH,
      slotGap, subBarH, groupStartOffset,
      counts: state.counts,
      binLabels: opts.binLabels,
      seriesNames: opts.seriesNames,
      renderMode: opts.renderMode,
    };
  }

  hitTest(mouseX: number, mouseY: number): GroupedBarChartHitInfo | null {
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

    const relY = mouseY - p.padT;
    const bIdx = Math.max(0, Math.min(p.n - 1, Math.floor(relY / p.slotH)));
    const binLabel = p.binLabels?.[bIdx] ?? "";

    if (p.renderMode === "grouped") {
      const relYInSlot = relY - bIdx * p.slotH - p.groupStartOffset;
      if (relYInSlot < 0 || relYInSlot >= p.subBarH * p.nCats) return null;

      const cIdx = Math.max(
        0,
        Math.min(p.nCats - 1, Math.floor(relYInSlot / p.subBarH)),
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

    // Stacked: определяем сегмент по X
    const stackVals: number[] = [];
    let sum = 0;
    for (let c = 0; c < p.nCats; ++c) {
      const v = p.counts[bIdx * p.nCats + c];
      stackVals.push(v);
      sum += v;
    }
    if (sum === 0) return null;

    const totalW = (sum / p.niceMax) * p.plotW;
    const xFromLeft = mouseX - p.padL;
    if (xFromLeft < 0 || xFromLeft > totalW) return null;

    let cum = 0;
    for (let c = 0; c < p.nCats; ++c) {
      const segW = (stackVals[c] / sum) * totalW;
      if (xFromLeft >= cum && xFromLeft < cum + segW) {
        return {
          bucketIndex: bIdx,
          categoryIndex: c,
          value: stackVals[c],
          bucketLabel: binLabel,
          seriesName: p.seriesNames[c] ?? `серия ${c + 1}`,
        };
      }
      cum += segW;
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