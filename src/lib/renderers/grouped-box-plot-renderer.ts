import type { BoxPlotChunkResult } from "../sift-core.js";
import { formatNumberPrecise } from "./histogram-renderer.js";

export interface GroupedBoxPlotDrawOptions {
  /** Имена категорий в порядке отрисовки (слева направо). */
  categoryNames: string[];
  /** Сколько групп не поместилось из-за предохранителя (подпись «+K ещё»). */
  hiddenGroupCount?: number;
  xLabel?: string;
  yLabel?: string;
  /** Рисовать ли легенду серий. */
  showLegend?: boolean;
  /** Имена серий (категорий) для отображения в легенде. */
  seriesNames?: string[];
  placeholder?: string;
  showGrid?: boolean;
  showAxisLabels?: boolean;
  precision?: number;
  /** Прогресс: сколько значений обработано суммарно. */
  processed?: number;
  total?: number;
}

export interface GroupedBoxPlotHitInfo {
  categoryIndex: number;
  categoryName: string;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  count: number;
}

/**
 * Групповой box plot: N ящиков рядом на общей шкале значений.
 *
 * Состояния приходят по одному на категорию (каждое посчитано
 * отдельным runProgressiveBoxPlot). Общая шкала — принципиальное
 * решение: иначе ящики нельзя сравнивать между собой.
 */
export class GroupedBoxPlotRenderer {
  private ctx: CanvasRenderingContext2D;
  private hasData = false;
  private lastPlot: {
    padL: number;
    padT: number;
    plotW: number;
    plotH: number;
    slotW: number;
    states: (BoxPlotChunkResult | null)[];
    names: string[];
  } | null = null;

  // Та же палитра, что в grouped-гистограмме и grouped-линейчатой.
  private readonly PALETTE = [
    "#4a9eff",
    "#f59e0b",
    "#10b981",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
    "#f97316",
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

  draw(
    states: (BoxPlotChunkResult | null)[],
    opts: GroupedBoxPlotDrawOptions,
  ) {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    const names = opts.categoryNames;
    const n = names.length;

    const showGrid = opts.showGrid !== false;
    const showAxisLabels = opts.showAxisLabels !== false;
    const precision =
      typeof opts.precision === "number" ? opts.precision : 2;

    const AXIS_FONT = "12px -apple-system, sans-serif";
    const AXIS_COLOR = "#000000";

    // ---- Общий диапазон значений по всем группам ----
    let globalMin = Infinity;
    let globalMax = -Infinity;
    let globalCount = 0;
    let anyData = false;

    for (const st of states) {
      if (!st || st.count < 5) continue;
      anyData = true;
      globalCount += st.count;
      if (st.min < globalMin) globalMin = st.min;
      if (st.max > globalMax) globalMax = st.max;
    }

    if (!anyData) {
      globalMin = 0;
      globalMax = 1;
    }

    // Лог-шкала — только если все значения положительны.
    const useLog = anyData && globalMin > 0;

    let vMin = globalMin;
    let vMax = globalMax;
    let logMin = 0;
    let logMax = 1;

    if (useLog) {
      logMin = Math.log10(globalMin);
      logMax = Math.log10(globalMax);
      const logSpan = logMax - logMin || 1;
      logMin -= logSpan * 0.03;
      logMax += logSpan * 0.03;
    } else {
      const span = vMax - vMin || 1;
      vMin -= span * 0.05;
      vMax += span * 0.05;
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
    let padL = 60;
    if (showAxisLabels) {
      ctx.font = AXIS_FONT;
      let maxYLabelW = 0;
      for (let i = 0; i <= 5; ++i) {
        const t = i / 5;
        const v = useLog
          ? Math.pow(10, logMin + t * (logMax - logMin))
          : vMin + t * (vMax - vMin);
        const w = ctx.measureText(formatTick(v)).width;
        if (w > maxYLabelW) maxYLabelW = w;
      }
      padL = Math.max(60, 14 + Math.ceil(maxYLabelW) + 16);
    }

    const padR = 20;

    const LEGEND_FONT = "11px -apple-system, sans-serif";
    const seriesNames = opts.seriesNames ?? [];
    const hasLegend = opts.showLegend === true && seriesNames.length > 0;
    const LEGEND_ROW_H = 16;
    const LEGEND_PAD_Y = 10;
    const LEGEND_H = hasLegend ? seriesNames.length * LEGEND_ROW_H + LEGEND_PAD_Y : 0;
    const LEGEND_GAP = hasLegend ? 6 : 0;

    const padT = 20 + LEGEND_H + LEGEND_GAP;
    const axisXLabelH = opts.xLabel ? 20 : 0;
    // Подписи категорий + подпись оси X + прогресс-полоса.
    const padB = 12 + 18 + axisXLabelH + 20;

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (plotW <= 10 || plotH <= 10) {
      this.hasData = false;
      return;
    }

    const valueToY = (v: number): number => {
      if (useLog) {
        const lv = Math.log10(Math.max(v, 1e-12));
        return padT + plotH - ((lv - logMin) / (logMax - logMin)) * plotH;
      }
      return padT + plotH - ((v - vMin) / (vMax - vMin)) * plotH;
    };

    // ---- Оси ----
    ctx.strokeStyle = "#c8cfd8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // ---- Плейсхолдер: нет групп или ни в одной не хватает данных ----
    if (n === 0 || !anyData) {
      this.hasData = false;
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        opts.placeholder ?? "Нужно минимум 5 значений в каждой группе",
        padL + plotW / 2,
        padT + plotH / 2,
      );
      return;
    }

    // ---- Y-тики ----
    const tickYPositions: number[] = [];
    const tickValues: number[] = [];

    for (let i = 0; i <= 5; ++i) {
      const t = i / 5;
      tickYPositions.push(padT + plotH - t * plotH);
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

    // ---- Ящики ----
    const slotW = plotW / n;
    const boxW = Math.max(8, Math.min(slotW * 0.55, 90));

    for (let i = 0; i < n; ++i) {
      const cx = padL + slotW * (i + 0.5);
      const color = this.PALETTE[i % this.PALETTE.length];
      const st = states[i] ?? null;

      // ---- Подпись категории ----
      if (showAxisLabels) {
        ctx.font = AXIS_FONT;
        ctx.fillStyle = "#334155";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(
          this.truncateToWidth(names[i] ?? "", Math.max(20, slotW - 6)),
          cx,
          padT + plotH + 6,
        );
      }

      if (!st || st.count < 5) {
        // Пунктирная рамка-заглушка слота
        ctx.save();
        ctx.strokeStyle = "#d8dde3";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeRect(
          cx - boxW / 2,
          padT + plotH / 2 - 30,
          boxW,
          60,
        );
        ctx.restore();

        ctx.fillStyle = "#cbd5e1";
        ctx.font = "10px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("мало данных", cx, padT + plotH / 2 - 34);
        continue;
      }

      const yQ1 = valueToY(st.q1);
      const yMed = valueToY(st.median);
      const yQ3 = valueToY(st.q3);

      const hasFences =
        typeof st.upperFence === "number" &&
        typeof st.lowerFence === "number";

      const upperWhiskerVal = hasFences
        ? Math.min(st.max, st.upperFence)
        : st.max;
      const lowerWhiskerVal = hasFences
        ? Math.max(st.min, st.lowerFence)
        : st.min;

      const yUpperWhisker = valueToY(upperWhiskerVal);
      const yLowerWhisker = valueToY(lowerWhiskerVal);

      // Усы
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, yLowerWhisker);
      ctx.lineTo(cx, yQ1);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx, yQ3);
      ctx.lineTo(cx, yUpperWhisker);
      ctx.stroke();

      // Капы
      const capW = boxW * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx - capW / 2, yLowerWhisker);
      ctx.lineTo(cx + capW / 2, yLowerWhisker);
      ctx.moveTo(cx - capW / 2, yUpperWhisker);
      ctx.lineTo(cx + capW / 2, yUpperWhisker);
      ctx.stroke();

      // Ящик
      const boxTop = Math.min(yQ1, yQ3);
      const boxH = Math.max(1, Math.abs(yQ1 - yQ3));
      ctx.fillStyle = this.withAlpha(color, 0.16);
      ctx.fillRect(cx - boxW / 2, boxTop, boxW, boxH);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        cx - boxW / 2 + 0.5,
        boxTop + 0.5,
        boxW - 1,
        boxH - 1,
      );

      // Медиана
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - boxW / 2, yMed);
      ctx.lineTo(cx + boxW / 2, yMed);
      ctx.stroke();

      // Выбросы — только когда группа посчитана полностью
      if (st.done) {
        const jitterRange = boxW * 0.5;
        ctx.fillStyle = color;
        const drawOutliers = (arr: number[]) => {
          if (!arr || arr.length === 0) return;
          for (const v of arr) {
            const y = valueToY(v);
            const dx = this.outlierJitter(v, jitterRange);
            ctx.beginPath();
            ctx.arc(cx + dx, y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        };
        drawOutliers(st.upperOutliers);
        drawOutliers(st.lowerOutliers);
      }
    }

    // ---- «+K ещё» — группы, не поместившиеся из-за предохранителя ----
    const hidden = opts.hiddenGroupCount ?? 0;
    if (hidden > 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(
        `+${hidden.toLocaleString("ru-RU")} ещё`,
        padL + plotW,
        padT + 4,
      );
    }

    // ---- Легенда серий (как в grouped-histogram-renderer.ts) ----
    // try/catch: ошибка отрисовки легенды не должна крашить диаграмму.
    if (hasLegend) {
      try {
        ctx.font = LEGEND_FONT;
        let legendW = 0;
        for (const s of seriesNames) {
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
        for (let i = 0; i < seriesNames.length; i++) {
          const y = legendY + LEGEND_PAD_Y / 2 + i * LEGEND_ROW_H;
          ctx.fillStyle = this.PALETTE[i % this.PALETTE.length];
          ctx.fillRect(legendX + 6, y - 4, 8, 8);
          ctx.fillStyle = "#334155";
          ctx.fillText(seriesNames[i], legendX + 18, y);
        }
      } catch (e) {
        console.error("[GroupedBoxPlotRenderer] Легенда серий:", e);
      }
    }

    // ---- X-подпись (категории) ----
    if (opts.xLabel) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, padL + plotW / 2, H - 22);
    }

    // ---- Y-подпись (значения) ----
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
    let totalAll = opts.total ?? 0;
    if (totalAll <= 0) {
      totalAll = 0;
      for (const st of states) totalAll += st?.total ?? 0;
    }
    const processed = opts.processed ?? 0;
    const progress = totalAll > 0 ? processed / totalAll : 0;

    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(padL, H - 3, plotW, 2);
    ctx.fillStyle = this.PALETTE[0];
    ctx.fillRect(padL, H - 3, plotW * progress, 2);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${(progress * 100).toFixed(1)}% · ${processed.toLocaleString("ru-RU")} из ${totalAll.toLocaleString("ru-RU")}`,
      padL + plotW,
      H - 6,
    );

    // ---- Σ — отрисованные значения / всего обработанных ----
    ctx.textAlign = "left";
    const sumText = `Σ ${globalCount.toLocaleString("ru-RU")} / ${totalAll.toLocaleString("ru-RU")}`;
    ctx.fillStyle = globalCount === totalAll ? "#16a34a" : "#dc2626";
    ctx.fillText(sumText, padL, H - 6);

    this.lastPlot = {
      padL,
      padT,
      plotW,
      plotH,
      slotW,
      states,
      names,
    };
    this.hasData = true;
  }

  hitTest(mouseX: number, mouseY: number): GroupedBoxPlotHitInfo | null {
    if (!this.hasData || !this.lastPlot) return null;
    const { padL, padT, plotW, plotH, slotW, states, names } = this.lastPlot;

    if (mouseX < padL || mouseX > padL + plotW) return null;
    if (mouseY < padT || mouseY > padT + plotH) return null;

    const idx = Math.floor((mouseX - padL) / slotW);
    if (idx < 0 || idx >= states.length) return null;

    const st = states[idx];
    if (!st || st.count < 5) return null;

    return {
      categoryIndex: idx,
      categoryName: names[idx] ?? "",
      q1: st.q1,
      median: st.median,
      q3: st.q3,
      iqr: st.iqr,
      min: st.min,
      max: st.max,
      count: st.count,
    };
  }

  /** Обрезает текст по ширине с многоточием. */
  private truncateToWidth(text: string, maxW: number): string {
    const ctx = this.ctx;
    if (ctx.measureText(text).width <= maxW) return text;

    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = text.slice(0, mid) + "…";
      if (ctx.measureText(candidate).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? text.slice(0, lo) + "…" : "…";
  }

  /** Цвет палитры с прозрачностью (для заливки ящика). */
  private withAlpha(hex: string, alpha: number): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /** Детерминированный jitter — точки не «дрожат» между кадрами. */
  private outlierJitter(value: number, range: number): number {
    const h = Math.sin(value * 12.9898 + 4.1414) * 43758.5453;
    return (h - Math.floor(h) - 0.5) * range;
  }
}

// HMR: модуль принимает сам себя, чтобы Vite не делал full reload.
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (!mod) return;
    window.dispatchEvent(
      new CustomEvent("sift:renderer-updated", {
        detail: { type: "grouped-boxplot", module: mod },
      }),
    );
  });
}
