import type { ParsedData } from "../loader.js";

export type BusinessMode = "trend" | "ranking" | "ranking-columns" | "scatter";

export function isRankingMode(mode: BusinessMode) {
  return mode === "ranking" || mode === "ranking-columns";
}
export type Aggregation = "sum" | "average" | "count";
export type Period = "day" | "week" | "month";

export interface BusinessSettings {
  aggregation: Aggregation;
  period: Period;
  limit: number;
  ascending: boolean;
  pointLimit: number;
  axisX?: string;
  axisY?: string;
}

type Cell = ParsedData["rows"][number][number] | undefined;
type Point = { x: number; y: number };
const DAY = 86_400_000;

function numericValue(cell: Cell) {
  const value = typeof cell === "number" || (typeof cell === "string" && cell.trim())
    ? Number(cell)
    : NaN;
  return Number.isFinite(value) ? value : undefined;
}

function categoryValue(cell: Cell) {
  if (cell instanceof Date) return Number.isFinite(cell.getTime()) ? cell.toISOString() : "";
  return cell == null ? "" : String(cell).trim();
}

function dateValue(cell: Cell, period: Period) {
  const day = cell instanceof Date
    ? (Number.isFinite(cell.getTime()) ? cell.toISOString().slice(0, 10) : "")
    : typeof cell === "string" ? cell.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const stamp = Date.parse(day);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== day) return undefined;
  const date = new Date(stamp);
  if (period === "month") return date.setUTCDate(1);
  if (period === "week") return stamp - ((date.getUTCDay() + 6) % 7) * DAY;
  return stamp;
}

export class BusinessData {
  readonly groups = new Map<number | string, { total: number; count: number }>();
  readonly points: Point[] = [];
  skipped = 0;
  valid = 0;
  minX = Infinity;
  maxX = -Infinity;
  minY = Infinity;
  maxY = -Infinity;
  private seed = 0x751f;

  add(mode: BusinessMode, settings: BusinessSettings, first: Cell, second: Cell) {
    if (mode === "scatter") {
      const x = numericValue(first);
      const y = numericValue(second);
      if (x === undefined || y === undefined) {
        this.skipped++;
        return;
      }
      this.valid++;
      this.minX = Math.min(this.minX, x);
      this.maxX = Math.max(this.maxX, x);
      this.minY = Math.min(this.minY, y);
      this.maxY = Math.max(this.maxY, y);
      if (this.points.length < settings.pointLimit) {
        this.points.push({ x, y });
      } else {
        // Reservoir sampling gives every valid pair the same chance to appear.
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        const index = Math.floor(this.seed / 2 ** 32 * this.valid);
        if (index < settings.pointLimit) this.points[index] = { x, y };
      }
      return;
    }

    const key = mode === "trend" ? dateValue(first, settings.period) : categoryValue(first);
    const metric = settings.aggregation === "count" ? 1 : numericValue(second);
    if (key === undefined || key === "" || metric === undefined) {
      this.skipped++;
      return;
    }
    this.valid++;
    const group = this.groups.get(key);
    if (group) {
      group.total += metric;
      group.count++;
    } else {
      this.groups.set(key, { total: metric, count: 1 });
    }
  }

  value(group: { total: number; count: number }, aggregation: Aggregation) {
    return aggregation === "average" ? group.total / group.count : group.total;
  }
}

const BLUE = "#2563eb";
const ORANGE = "#b45309";
const utcDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
});
const utcMonth = new Intl.DateTimeFormat("ru-RU", {
  month: "short", year: "numeric", timeZone: "UTC",
});

function nextPeriod(stamp: number, period: Period) {
  if (period === "day") return stamp + DAY;
  if (period === "week") return stamp + 7 * DAY;
  const day = new Date(stamp);
  return day.setUTCMonth(day.getUTCMonth() + 1);
}

function span(lo: number, hi: number, includeZero = false): [number, number] {
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo !== hi) return [lo, hi];
  const pad = Math.abs(lo) * 0.05 || 1;
  return [lo - pad, hi + pad];
}

type RankedRow = { name: string; value: number };

function rankedCategories(data: BusinessData, settings: BusinessSettings) {
  const rows = [...data.groups].map(([name, group]) => ({
    name: String(name), value: data.value(group, settings.aggregation),
  })).filter(({ value }) => Number.isFinite(value));
  rows.sort((a, b) => (settings.ascending ? a.value - b.value : b.value - a.value) || a.name.localeCompare(b.name, "ru"));
  return { rows: rows.slice(0, settings.limit), total: rows.length };
}

interface DrawOptions {
  axes: [string, string];
  metric: string;
  precision: number;
  showGrid: boolean;
  showLegend: boolean;
  showAxisLabels: boolean;
}

export class BusinessChartRenderer {
  private readonly canvas = document.createElement("canvas");
  private readonly info = document.createElement("p");
  private readonly legend = document.createElement("div");
  private readonly rankAxes = document.createElement("div");
  private readonly ranking = document.createElement("ol");
  private hover?: (x: number, y: number) => string;
  private summary = "";

  constructor(root: HTMLElement, mode: BusinessMode) {
    this.info.className = "business-chart-info";
    this.legend.className = "business-chart-legend";
    this.legend.setAttribute("aria-label", "Легенда диаграммы");
    this.legend.hidden = true;
    root.append(this.legend);
    if (mode === "ranking") {
      this.ranking.className = "business-ranking";
      this.rankAxes.className = "business-ranking-axes";
      root.append(this.rankAxes, this.ranking, this.info);
    } else {
      this.canvas.setAttribute("role", "img");
      root.append(this.canvas, this.info);
      this.canvas.addEventListener("pointermove", (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.info.textContent = this.hover?.(e.clientX - rect.left, e.clientY - rect.top) || this.summary;
      });
      this.canvas.addEventListener("pointerleave", () => { this.info.textContent = this.summary; });
    }
  }

  draw(data: BusinessData, mode: BusinessMode, s: BusinessSettings, o: DrawOptions) {
    const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: o.precision });
    const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: Math.max(1, o.precision) });
    const count = new Intl.NumberFormat("ru-RU");
    const skipped = data.skipped ? ` · Пропущено: ${count.format(data.skipped)}` : "";
    this.summary = data.valid ? `Учтено строк: ${count.format(data.valid)}${skipped}`
      : `Нет подходящих данных${skipped}`;
    this.hover = undefined;
    const ranking = isRankingMode(mode) ? rankedCategories(data, s) : undefined;
    const columns = mode === "ranking-columns";
    const ranked = ranking?.rows ?? [];
    this.drawLegend(o, mode, ranked.some(({ value }) => value < 0));
    if (ranking && data.valid) {
      this.summary = ranked.length
        ? `Показано ${ranked.length} из ${ranking.total} категорий · ${this.summary}`
        : "Сумма превышает числовой диапазон";
    }
    if (mode === "ranking") {
      this.drawRanking(ranked, o, nf);
      this.info.textContent = this.summary;
      return;
    }

    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(this.canvas.width / w, this.canvas.height / h);
    if (!data.valid) {
      this.canvas.setAttribute("aria-label", this.summary);
      this.info.textContent = this.summary;
      return;
    }

    const dateFormat = s.period === "month" ? utcMonth : utcDate;
    const trend = mode === "trend";
    const points = trend
      ? [...data.groups].map(([key, group]) => ({ x: Number(key), y: data.value(group, s.aggregation) }))
        .filter(({ y }) => Number.isFinite(y)).sort((a, b) => a.x - b.x)
      : columns ? ranked.map(({ value }, index) => ({ x: index, y: value })) : data.points;
    if (!points.length) {
      this.summary = "Сумма превышает числовой диапазон";
      this.canvas.setAttribute("aria-label", this.summary);
      this.info.textContent = this.summary;
      return;
    }
    let minY = data.minY;
    let maxY = data.maxY;
    if (trend || columns) {
      minY = Infinity;
      maxY = -Infinity;
      for (const { y } of points) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    } else if (points.length < data.valid) {
      this.summary = `Выборка: ${count.format(points.length)} из ${count.format(data.valid)} пар${skipped}`;
    }
    const minX = trend ? points[0].x : data.minX;
    const maxX = trend ? points[points.length - 1].x : data.maxX;
    const [xMin, xMax] = columns ? [-0.5, points.length - 0.5] : span(minX, maxX);
    const [yMin, yMax] = span(minY, maxY, trend || columns);
    const [xName, yName] = o.axes;

    const left = 65;
    const right = w - 18;
    const top = o.showAxisLabels ? 21 : 12;
    const bottom = h - (o.showAxisLabels ? 43 : 27);
    this.canvas.setAttribute("aria-label", `${xName} × ${yName}. ${this.summary}`);
    this.info.textContent = this.summary;
    if (right <= left || bottom <= top) return;

    const xAt = (v: number) => left + (v - xMin) / (xMax - xMin) * (right - left);
    const yAt = (v: number) => bottom - (v - yMin) / (yMax - yMin) * (bottom - top);
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#334155";
    ctx.textBaseline = "middle";
    const axis = (x1: number, y1: number, x2: number, y2: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const value = yMin + (yMax - yMin) * i / 4;
      const y = yAt(value);
      if (o.showGrid) axis(left, y, right, y, "#e2e8f0");
      ctx.fillText(compact.format(value), left - 6, y, left - 8);
    }
    axis(left, top, left, bottom, "#94a3b8");
    axis(left, bottom, right, bottom, "#94a3b8");
    ctx.textAlign = "center";
    const ticks = Math.max(2, Math.min(5, Math.floor((right - left) / (trend ? 85 : 65))));
    const xTicks = trend
      ? [...new Set(Array.from({ length: ticks }, (_, i) => points[Math.round(i * (points.length - 1) / (ticks - 1))].x))]
      : Array.from({ length: ticks }, (_, i) => xMin + (xMax - xMin) * i / (ticks - 1));
    if (columns) {
      this.drawColumns(ctx, ranked, left, right, top, bottom, xAt, yAt, nf, o);
    } else {
      xTicks.forEach((value, index) => {
        ctx.textAlign = xTicks.length === 1 ? "center" : index === 0 ? "left" : index === xTicks.length - 1 ? "right" : "center";
        const label = trend ? dateFormat.format(value) : compact.format(value);
        ctx.fillText(label, xAt(value), bottom + 13, Math.min(87, (right - left) / Math.max(2, xTicks.length - 1)));
      });
    }
    if (o.showAxisLabels) {
      ctx.fillStyle = "#334155";
      ctx.textAlign = "left";
      ctx.fillText(yName, 4, 8, w - 8);
      ctx.textAlign = "center";
      ctx.fillText(xName, (left + right) / 2, h - 10, right - left);
    }
    if (columns) return;
    if (trend) {
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach(({ x, y }, i) => {
        if (i === 0 || nextPeriod(points[i - 1].x, s.period) !== x) ctx.moveTo(xAt(x), yAt(y));
        else ctx.lineTo(xAt(x), yAt(y));
      });
      ctx.stroke();
    }
    ctx.fillStyle = trend ? BLUE : "rgba(37, 99, 235, 0.38)";
    for (const { x, y } of points) {
      ctx.beginPath();
      ctx.arc(xAt(x), yAt(y), trend ? 3 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    this.hover = (px, py) => {
      let nearest: Point | undefined;
      let distance = 10;
      for (const point of points) {
        const d = Math.hypot(px - xAt(point.x), py - yAt(point.y));
        if (d < distance) {
          distance = d;
          nearest = point;
        }
      }
      if (!nearest) return "";
      const xText = trend ? dateFormat.format(nearest.x) : nf.format(nearest.x);
      return `${xName}: ${xText} · ${yName}: ${nf.format(nearest.y)}`;
    };
  }

  private drawLegend(options: DrawOptions, mode: BusinessMode, hasNegative: boolean) {
    this.legend.hidden = !options.showLegend;
    if (!options.showLegend) return;
    const entry = (text: string, color: string, shape: string) => {
      const row = document.createElement("span");
      const swatch = document.createElement("i");
      swatch.className = shape;
      swatch.style.backgroundColor = color;
      row.append(swatch, text);
      return row;
    };
    const shape = mode === "trend" ? "legend-line" : mode === "scatter" ? "legend-point" : "legend-bar";
    const items = [entry(options.metric, BLUE, shape)];
    if (hasNegative) items.push(entry("Отрицательные значения", ORANGE, shape));
    this.legend.replaceChildren(...items);
  }

  private drawColumns(
    ctx: CanvasRenderingContext2D, rows: RankedRow[],
    left: number, right: number, top: number, bottom: number,
    xAt: (x: number) => number, yAt: (y: number) => number,
    nf: Intl.NumberFormat, o: DrawOptions,
  ) {
    const width = (right - left) / rows.length;
    const zero = yAt(0);
    const labelStep = Math.max(1, Math.ceil(48 / width));
    ctx.strokeStyle = "#94a3b8";
    ctx.beginPath();
    ctx.moveTo(left, zero);
    ctx.lineTo(right, zero);
    ctx.stroke();
    ctx.textAlign = "center";
    for (const [index, row] of rows.entries()) {
      const x = xAt(index);
      const y = yAt(row.value);
      ctx.fillStyle = row.value < 0 ? ORANGE : BLUE;
      if (row.value !== 0) ctx.fillRect(x - width * 0.34, Math.min(y, zero), width * 0.68, Math.abs(y - zero));
      if (index % labelStep) continue;
      ctx.fillStyle = "#334155";
      const limit = width * labelStep - 6;
      let label = row.name;
      while (label.length > 1 && ctx.measureText(label).width > limit) {
        label = label.slice(0, label.endsWith("…") ? -2 : -1) + "…";
      }
      ctx.fillText(label, x, bottom + 13, Math.max(1, limit));
    }
    this.hover = (x, y) => {
      if (x < left || x >= right || y < top || y > bottom + 20) return "";
      const row = rows[Math.floor((x - left) / width)];
      return row ? `${row.name} · ${o.axes[1]}: ${nf.format(row.value)}` : "";
    };
  }

  private drawRanking(ranked: RankedRow[], o: DrawOptions, nf: Intl.NumberFormat) {
    this.rankAxes.hidden = !o.showAxisLabels;
    this.rankAxes.replaceChildren();
    if (o.showAxisLabels) {
      for (const name of [o.axes[1], o.axes[0]]) {
        const label = document.createElement("span");
        label.textContent = name;
        label.title = name;
        this.rankAxes.append(label);
      }
    }
    this.ranking.replaceChildren();
    if (!ranked.length) return;
    const min = Math.min(0, ...ranked.map(({ value }) => value));
    const max = Math.max(0, ...ranked.map(({ value }) => value));
    const range = max - min || 1;
    const zero = (-min / range) * 100;
    for (const { name, value } of ranked) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = name;
      label.title = name;
      const track = document.createElement("span");
      track.className = "business-ranking-track";
      track.setAttribute("aria-hidden", "true");
      const bar = document.createElement("span");
      bar.className = "business-ranking-bar";
      bar.style.left = `${value < 0 ? ((value - min) / range) * 100 : zero}%`;
      bar.style.width = `${(Math.abs(value) / range) * 100}%`;
      bar.style.backgroundColor = value >= 0 ? BLUE : ORANGE;
      track.append(bar);
      const metric = document.createElement("strong");
      metric.textContent = nf.format(value);
      item.append(label, track, metric);
      item.title = `${name} · ${o.metric}: ${metric.textContent}`;
      this.ranking.append(item);
    }
  }
}
