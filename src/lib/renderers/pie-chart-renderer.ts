import type { ParsedData } from "../loader.js";

export type PieMode = "count" | "sum" | "compare";
export type PieLabels = "percent" | "value" | "none";

export interface PieData {
  groups: Map<string, Map<string, number>>;
  skipped: number;
}

export function accumulatePie(
  data: PieData,
  rows: ParsedData["rows"],
  start: number,
  end: number,
  mode: PieMode,
  categoryColumn: number,
  secondColumn: number,
) {
  for (let i = start; i < end; i++) {
    const row = rows[i];
    const category = categoryName(row[categoryColumn]);
    const group = mode === "compare" ? categoryName(row[secondColumn]) : "";
    const raw = row[secondColumn];
    const value = mode === "sum"
      ? (typeof raw === "number" || (typeof raw === "string" && raw.trim())
        ? Number(raw) : NaN)
      : 1;

    if (!category || group === null || !Number.isFinite(value) || value < 0) {
      data.skipped++;
      continue;
    }

    let counts = data.groups.get(group);
    if (!counts) {
      counts = new Map();
      data.groups.set(group, counts);
    }
    counts.set(category, (counts.get(category) ?? 0) + value);
  }
}

function categoryName(value: ParsedData["rows"][number][number] | undefined) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString().replace("T", " ").replace(/\.000Z$/, "") : null;
  }
  return String(value).trim() || null;
}

const COLORS = [
  "#2563eb", "#0f766e", "#c2410c", "#7c3aed", "#be185d", "#4d7c0f",
  "#a16207", "#0369a1", "#9333ea", "#b91c1c", "#334155", "#047857",
];
const OTHER_COLOR = "#64748b";

export function pieGroupNames(data: PieData): string[] {
  return [...data.groups].map(([name, counts]) => [name, totalOf(counts.values())] as const)
    .sort(([a, aTotal], [b, bTotal]) => bTotal - aTotal || a.localeCompare(b, "ru"))
    .map(([name]) => name);
}

function totalOf(values: Iterable<number>) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function pieSeries(data: PieData, groups: string[], topN: number) {
  const rankings = new Map<string, number>();
  const selected = groups.map((name) => ({
    name,
    counts: data.groups.get(name) ?? new Map<string, number>(),
  }));
  for (const { counts } of selected) {
    for (const [name, value] of counts) {
      rankings.set(name, (rankings.get(name) ?? 0) + value);
    }
  }
  const names = [...rankings].filter(([, value]) => value > 0)
    .sort(([a, aValue], [b, bValue]) => bValue - aValue || a.localeCompare(b, "ru"))
    .slice(0, topN).map(([name]) => name);
  const visible = new Set(names);

  return selected.map(({ name, counts }) => {
    let other = 0;
    for (const [category, value] of counts) {
      if (!visible.has(category)) other += value;
    }
    const slices = names.map((label, index) => ({
      label, value: counts.get(label) ?? 0, color: COLORS[index],
    }));
    if (other > 0) slices.push({ label: "Прочие категории (суммарно)", value: other, color: OTHER_COLOR });
    return { name, slices, total: totalOf(counts.values()) };
  });
}

interface PieOptions {
  hole: boolean;
  labels: PieLabels;
  showLegend: boolean;
  precision: number;
}

const TAU = 2 * Math.PI;

export class PieChartRenderer {
  constructor(private readonly root: HTMLElement) {}

  draw(series: ReturnType<typeof pieSeries>, options: PieOptions) {
    this.root.replaceChildren();
    const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: options.precision });
    const percent = new Intl.NumberFormat("ru-RU", {
      style: "percent", maximumFractionDigits: options.precision,
    });

    const grid = document.createElement("div");
    grid.className = "sift-pies";
    this.root.append(grid);
    for (const { name, total, slices } of series) {
      const figure = document.createElement("figure");
      const caption = document.createElement("figcaption");
      caption.textContent = name ? `${name} · Итого: ${number.format(total)}` : `Итого: ${number.format(total)}`;
      caption.title = caption.textContent;
      figure.append(caption);
      grid.append(figure);

      if (!Number.isFinite(total) || total <= 0) {
        caption.textContent = Number.isFinite(total)
          ? `${name ? name + " · " : ""}Нет положительных значений`
          : "Сумма превышает числовой диапазон";
        caption.title = caption.textContent;
        continue;
      }

      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${name ? name + ": " : ""}${slices.filter(({value}) => value > 0)
        .map(({label, value}) => `${label} — ${percent.format(value / total)}`).join(", ")}`);
      figure.append(canvas);
      const segments = slices.filter(({ value }) => value > 0);
      const side = canvas.clientWidth;
      if (side < 1) continue;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(side * dpr);
      canvas.height = canvas.width;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.scale(canvas.width / side, canvas.height / side);
      const center = side / 2;
      const radius = center - 3;
      if (radius <= 0) continue;
      const hole = options.hole ? radius * 0.53 : 0;
      const boundaries: number[] = [];
      let angle = 0;
      const legend = document.createElement("ul");
      legend.className = "sift-pie-legend";

      for (const [index, slice] of segments.entries()) {
        const fraction = slice.value / total;
        const end = index === segments.length - 1 ? TAU : Math.min(TAU, angle + fraction * TAU);
        boundaries.push(end);
        ctx.beginPath();
        ctx.arc(center, center, radius, angle - Math.PI / 2, end - Math.PI / 2);
        if (hole) ctx.arc(center, center, hole, end - Math.PI / 2, angle - Math.PI / 2, true);
        else ctx.lineTo(center, center);
        ctx.closePath();
        ctx.fillStyle = slice.color;
        ctx.fill();

        const label = options.labels === "percent" ? percent.format(fraction) : number.format(slice.value);
        if (options.labels !== "none" && side >= 110 && fraction >= 0.085) {
          const mid = (angle + end) / 2 - Math.PI / 2;
          const labelRadius = hole ? (hole + radius) / 2 : radius * 0.65;
          ctx.fillStyle = "#fff";
          ctx.font = "600 11px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const maxWidth = Math.min(radius * 0.47, (end - angle) * labelRadius * 0.85);
          if (ctx.measureText(label).width <= maxWidth) {
            ctx.fillText(label, center + Math.cos(mid) * labelRadius, center + Math.sin(mid) * labelRadius);
          }
        }
        angle = end;

        if (options.showLegend) {
          const item = document.createElement("li");
          const swatch = document.createElement("span");
          swatch.style.backgroundColor = slice.color;
          const label = document.createElement("span");
          label.textContent = slice.label;
          const metric = document.createElement("strong");
          metric.textContent = `${number.format(slice.value)} · ${percent.format(fraction)}`;
          item.title = `${slice.label}: ${metric.textContent}`;
          item.append(swatch, label, metric);
          legend.append(item);
        }
      }

      canvas.addEventListener("pointermove", (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left - center;
        const y = event.clientY - rect.top - center;
        const distance = Math.hypot(x, y);
        const angle = (Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU;
        const slice = distance >= hole && distance <= radius
          ? segments[boundaries.findIndex((end) => angle < end)] : undefined;
        canvas.title = slice ? `${slice.label}: ${number.format(slice.value)} · ${percent.format(slice.value / total)}` : "";
      });
      if (options.showLegend) figure.append(legend);
    }
  }
}
