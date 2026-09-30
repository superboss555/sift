import * as XLSX from "xlsx";

// ============================================================
// SEEDED RNG (mulberry32) — воспроизводимая генерация
// ============================================================

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function lognormal(rng: () => number, median: number, sigma: number): number {
  return median * Math.exp(sigma * gaussian(rng));
}

function weightedPick<T>(rng: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ============================================================
// СЛОВАРИ ДАННЫХ
// ============================================================

const REGIONS = [
  "Москва",
  "Санкт-Петербург",
  "Новосибирск",
  "Екатеринбург",
  "Казань",
  "Краснодар",
  "Другие",
];
const REGION_WEIGHTS = [0.3, 0.2, 0.12, 0.12, 0.1, 0.08, 0.08];

const CITIES: Record<string, string[]> = {
  Москва: ["Москва"],
  "Санкт-Петербург": ["Санкт-Петербург"],
  Новосибирск: ["Новосибирск", "Бердск"],
  Екатеринбург: ["Екатеринбург", "Верхняя Пышма"],
  Казань: ["Казань", "Зеленодольск"],
  Краснодар: ["Краснодар", "Сочи"],
  Другие: ["Самара", "Ростов-на-Дону", "Уфа", "Пермь"],
};

const CATEGORIES = [
  "Электроника",
  "Одежда",
  "Продукты",
  "Книги",
  "Игрушки",
  "Мебель",
  "Спорт",
  "Косметика",
];
const CATEGORY_WEIGHTS = [0.18, 0.22, 0.2, 0.1, 0.08, 0.06, 0.08, 0.08];

const PRODUCTS: Record<string, string[]> = {
  Электроника: ["Смартфон", "Ноутбук", "Наушники", "Планшет", "Телевизор", "Умные часы"],
  Одежда: ["Куртка", "Джинсы", "Футболка", "Платье", "Свитер", "Кроссовки"],
  Продукты: ["Хлеб", "Молоко", "Сыр", "Кофе", "Чай", "Шоколад", "Масло"],
  Книги: ["Роман", "Учебник", "Детектив", "Фантастика", "Биография"],
  Игрушки: ["Конструктор", "Кукла", "Машинка", "Пазл", "Настольная игра"],
  Мебель: ["Диван", "Стол", "Стул", "Шкаф", "Кровать", "Комод"],
  Спорт: ["Велосипед", "Гантели", "Коврик", "Скакалка", "Мяч", "Рюкзак"],
  Косметика: ["Крем", "Шампунь", "Помада", "Тушь", "Парфюм", "Тоник"],
};

const MANAGERS = [
  "Иванов",
  "Петров",
  "Сидоров",
  "Кузнецова",
  "Смирнов",
  "Волкова",
  "Морозов",
  "Новикова",
];

const CHANNELS = ["Онлайн", "Офлайн", "Маркетплейс", "Партнёр"];
const CHANNEL_WEIGHTS = [0.45, 0.25, 0.2, 0.1];

const PAYMENT_METHODS = ["Карта", "Наличные", "Рассрочка", "Онлайн-кошелёк"];
const PAYMENT_WEIGHTS = [0.55, 0.15, 0.1, 0.2];

const SEGMENTS = ["Новый", "Постоянный", "VIP", "Ушедший"];
const SEGMENT_WEIGHTS = [0.35, 0.45, 0.1, 0.1];

const CATEGORY_PRICE: Record<string, [number, number]> = {
  Электроника: [25000, 0.85],
  Одежда: [3500, 0.7],
  Продукты: [500, 0.5],
  Книги: [800, 0.4],
  Игрушки: [1200, 0.55],
  Мебель: [35000, 0.75],
  Спорт: [8000, 0.7],
  Косметика: [1500, 0.6],
};

const RETURN_PROB: Record<string, number> = {
  Электроника: 0.08,
  Одежда: 0.18,
  Продукты: 0.02,
  Книги: 0.03,
  Игрушки: 0.05,
  Мебель: 0.06,
  Спорт: 0.07,
  Косметика: 0.04,
};

const AGE_BY_SEGMENT: Record<string, [number, number]> = {
  Новый: [18, 45],
  Постоянный: [25, 60],
  VIP: [35, 70],
  Ушедший: [20, 65],
};

const DELIVERY_BY_REGION: Record<string, [number, number]> = {
  Москва: [1, 3],
  "Санкт-Петербург": [2, 4],
  Новосибирск: [3, 7],
  Екатеринбург: [3, 7],
  Казань: [3, 6],
  Краснодар: [2, 5],
  Другие: [5, 14],
};

// ============================================================
// ГЕНЕРАЦИЯ СТРОК
// ============================================================

interface SaleRow {
  order_id: string;
  order_date: string;
  region: string;
  city: string;
  category: string;
  product: string;
  manager: string;
  channel: string;
  payment_method: string;
  customer_segment: string;
  customer_age: number;
  customer_rating: number | null;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  revenue: number;
  cost: number;
  profit: number;
  delivery_days: number | null;
  delivery_rating: number | null;
  is_returned: "Yes" | "No";
}

interface GenOptions {
  rows: number;
  seed: number;
  missingRate: number;
  seasonality: boolean;
}

function generateRows(opts: GenOptions): SaleRow[] {
  const rng = mulberry32(opts.seed);

  const startDate = new Date(Date.UTC(2024, 0, 1));
  const dayCount = 730;
  const monthWeights = [0.7, 0.7, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 1.1, 1.2, 1.8, 2.5];
  const dayWeights = new Array(dayCount);
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    const m = d.getUTCMonth();
    dayWeights[i] = opts.seasonality ? monthWeights[m] : 1.0;
  }
  const totalDayWeight = dayWeights.reduce((a, b) => a + b, 0);

  const pickDayIndex = () => {
    let r = rng() * totalDayWeight;
    for (let i = 0; i < dayCount; i++) {
      r -= dayWeights[i];
      if (r <= 0) return i;
    }
    return dayCount - 1;
  };

  const rows: SaleRow[] = [];

  for (let i = 0; i < opts.rows; i++) {
    const dayIdx = pickDayIndex();
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + dayIdx);
    const isoDate = date.toISOString().slice(0, 10);

    const region = weightedPick(rng, REGIONS, REGION_WEIGHTS);
    const city = CITIES[region][Math.floor(rng() * CITIES[region].length)];
    const category = weightedPick(rng, CATEGORIES, CATEGORY_WEIGHTS);
    const product =
      PRODUCTS[category][Math.floor(rng() * PRODUCTS[category].length)];
    const manager = MANAGERS[Math.floor(rng() * MANAGERS.length)];
    const channel = weightedPick(rng, CHANNELS, CHANNEL_WEIGHTS);
    const payment = weightedPick(rng, PAYMENT_METHODS, PAYMENT_WEIGHTS);
    const segment = weightedPick(rng, SEGMENTS, SEGMENT_WEIGHTS);

    const [ageMin, ageMax] = AGE_BY_SEGMENT[segment];
    const age = Math.floor(ageMin + rng() * (ageMax - ageMin + 1));

    let customerRating: number | null = null;
    if (rng() > opts.missingRate * 0.6) {
      const r = 3.8 + gaussian(rng) * 0.7;
      customerRating = Math.max(1, Math.min(5, Number(r.toFixed(1))));
    }

    const quantity = 1 + Math.floor(Math.pow(rng(), 1.7) * 20);

    const [medianPrice, sigma] = CATEGORY_PRICE[category];
    const unitPrice = Math.max(50, lognormal(rng, medianPrice, sigma));

    let discMax: number;
    switch (segment) {
      case "VIP": discMax = 25; break;
      case "Постоянный": discMax = 15; break;
      case "Ушедший": discMax = 30; break;
      default: discMax = 10;
    }
    const discountPct = Math.floor(Math.pow(rng(), 1.8) * discMax);

    const revenue = Number(
      (quantity * unitPrice * (1 - discountPct / 100)).toFixed(2),
    );
    const costRatio = 0.5 + rng() * 0.25;
    const cost = Number((revenue * costRatio).toFixed(2));
    const profit = Number((revenue - cost).toFixed(2));

    const [dMin, dMax] = DELIVERY_BY_REGION[region];
    let deliveryDays: number | null = null;
    if (rng() > opts.missingRate) {
      deliveryDays = dMin + Math.floor(rng() * (dMax - dMin + 1));
    }

    let deliveryRating: number | null = null;
    if (rng() > opts.missingRate * 1.5) {
      const base = 4.2 - Math.max(0, (deliveryDays ?? 5) - 3) * 0.15;
      const r = base + gaussian(rng) * 0.5;
      deliveryRating = Math.max(1, Math.min(5, Number(r.toFixed(1))));
    }

    const isReturned: "Yes" | "No" =
      rng() < RETURN_PROB[category] ? "Yes" : "No";

    rows.push({
      order_id: `ORD-${String(i + 1).padStart(6, "0")}`,
      order_date: isoDate,
      region,
      city,
      category,
      product,
      manager,
      channel,
      payment_method: payment,
      customer_segment: segment,
      customer_age: age,
      customer_rating: customerRating,
      quantity,
      unit_price: Number(unitPrice.toFixed(2)),
      discount_pct: discountPct,
      revenue,
      cost,
      profit,
      delivery_days: deliveryDays,
      delivery_rating: deliveryRating,
      is_returned: isReturned,
    });
  }

  rows.sort((a, b) => a.order_date.localeCompare(b.order_date));
  return rows;
}

// ============================================================
// ЭКСПОРТ В ФАЙЛ
// ============================================================

function rowsToSheet(rows: SaleRow[]): XLSX.WorkSheet {
  return XLSX.utils.json_to_sheet(rows);
}

function buildXlsxBuffer(rows: SaleRow[]): ArrayBuffer {
  const ws = rowsToSheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Продажи");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

function buildCsvBuffer(rows: SaleRow[]): ArrayBuffer {
  const ws = rowsToSheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  return new TextEncoder().encode(csv).buffer;
}

function downloadBlob(buffer: ArrayBuffer, filename: string, mime: string) {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

// ============================================================
// DOM
// ============================================================

const rowsInput = document.getElementById("rows") as HTMLInputElement;
const seedInput = document.getElementById("seed") as HTMLInputElement;
const missingSelect = document.getElementById("missing") as HTMLSelectElement;
const seasonalitySelect = document.getElementById(
  "seasonality",
) as HTMLSelectElement;
const btnXlsx = document.getElementById("btn-xlsx") as HTMLButtonElement;
const btnCsv = document.getElementById("btn-csv") as HTMLButtonElement;
const btnSave = document.getElementById("btn-save") as HTMLButtonElement;
const autosaveCheck = document.getElementById("autosave") as HTMLInputElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const previewEl = document.getElementById("preview") as HTMLDivElement;
const previewHint = document.getElementById("preview-hint") as HTMLSpanElement;
const errorEl = document.getElementById("error") as HTMLDivElement;

function readOptions(): GenOptions | null {
  const rows = Number(rowsInput.value);
  const seed = Number(seedInput.value);
  const missingRate = Number(missingSelect.value);
  const seasonality = Number(seasonalitySelect.value) === 1;

  if (!Number.isFinite(rows) || rows < 10 || rows > 1000000) {
    showError("Количество строк должно быть от 10 до 1 000 000");
    return null;
  }
  if (!Number.isFinite(seed)) {
    showError("Seed должен быть числом");
    return null;
  }
  hideError();
  return { rows, seed, missingRate, seasonality };
}

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}
function hideError() {
  errorEl.style.display = "none";
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

const PREVIEW_ROWS = 10;

function renderPreview(rows: SaleRow[]) {
  const sample = rows.slice(0, PREVIEW_ROWS);
  const headers = Object.keys(sample[0] ?? {}) as (keyof SaleRow)[];

  const html = `
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${sample
          .map(
            (row) => `
          <tr>${headers
            .map((h) => {
              const v = row[h];
              if (v == null) return `<td class="empty">—</td>`;
              return `<td>${escapeHtml(String(v))}</td>`;
            })
            .join("")}</tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;
  previewEl.innerHTML = html;
  previewHint.textContent = `Первые ${sample.length} из ${rows.length.toLocaleString("ru-RU")}`;
}

function renderStats(rows: SaleRow[], xlsxSize: number, csvSize: number) {
  const cols = Object.keys(rows[0] ?? {}).length;
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const uniqueOrders = new Set(rows.map((r) => r.order_id)).size;
  const uniqueCategories = new Set(rows.map((r) => r.category)).size;
  const returned = rows.filter((r) => r.is_returned === "Yes").length;

  statsEl.innerHTML = `
    <div class="row"><span>Строк</span><span class="val">${rows.length.toLocaleString("ru-RU")}</span></div>
    <div class="row"><span>Колонок</span><span class="val">${cols}</span></div>
    <div class="row"><span>Уникальных заказов</span><span class="val">${uniqueOrders.toLocaleString("ru-RU")}</span></div>
    <div class="row"><span>Категорий</span><span class="val">${uniqueCategories}</span></div>
    <div class="row"><span>Возвратов</span><span class="val">${returned} (${((returned / rows.length) * 100).toFixed(1)}%)</span></div>
    <div class="row"><span>Сумма выручки</span><span class="val">${totalRevenue.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽</span></div>
    <div class="row"><span>Размер XLSX</span><span class="val">${formatBytes(xlsxSize)}</span></div>
    <div class="row"><span>Размер CSV</span><span class="val">${formatBytes(csvSize)}</span></div>
  `;
}

// ============================================================
// СОХРАНЕНИЕ В ПРОЕКТ (через dev-плагин Vite)
// ============================================================

let currentBuffers: { xlsx: ArrayBuffer; csv: ArrayBuffer } | null = null;

async function saveDatasetToProject(
  buffer: ArrayBuffer,
  filename: string,
): Promise<void> {
  try {
    const res = await fetch("/api/save-dataset", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": filename,
      },
      body: buffer,
    });
    if (!res.ok) {
      const text = await res.text();
      showError(`Сервер ответил ${res.status}: ${text}`);
      return;
    }
    const json = (await res.json()) as { path: string; size: number };
    showSaved(json.path, json.size);
  } catch (err) {
    showError(`Не удалось сохранить: ${(err as Error).message}`);
  }
}

function showSaved(path: string, size: number) {
  errorEl.style.display = "none";
  let saved = document.getElementById("saved-message");
  if (!saved) {
    saved = document.createElement("div");
    saved.id = "saved-message";
    saved.className = "gen-saved";
    statsEl.parentElement?.appendChild(saved);
  }
  saved.innerHTML = `Файл сохранён: <code>${escapeHtml(path)}</code> · ${formatBytes(size)}`;
}

// ============================================================
// ГЕНЕРАЦИЯ
// ============================================================

function regenerate() {
  const opts = readOptions();
  if (!opts) return;

  const rows = generateRows(opts);
  const xlsxBuf = buildXlsxBuffer(rows);
  const csvBuf = buildCsvBuffer(rows);

  renderPreview(rows);
  renderStats(rows, xlsxBuf.byteLength, csvBuf.byteLength);

  currentBuffers = { xlsx: xlsxBuf, csv: csvBuf };

  if (autosaveCheck?.checked) {
    const stamp = `sift-sales-${opts.rows}-seed${opts.seed}`;
    void saveDatasetToProject(xlsxBuf, `${stamp}.xlsx`);
  }
}

// ============================================================
// ДЕЙСТВИЯ
// ============================================================

btnXlsx.addEventListener("click", () => {
  const opts = readOptions();
  if (!opts) return;
  if (!currentBuffers) regenerate();
  if (!currentBuffers) return;

  const stamp = `sift-sales-${opts.rows}-seed${opts.seed}`;
  downloadBlob(
    currentBuffers.xlsx,
    `${stamp}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});

btnCsv.addEventListener("click", () => {
  const opts = readOptions();
  if (!opts) return;
  if (!currentBuffers) regenerate();
  if (!currentBuffers) return;

  const stamp = `sift-sales-${opts.rows}-seed${opts.seed}`;
  downloadBlob(currentBuffers.csv, `${stamp}.csv`, "text/csv");
});

btnSave.addEventListener("click", () => {
  const opts = readOptions();
  if (!opts) return;
  if (!currentBuffers) regenerate();
  if (!currentBuffers) return;

  const stamp = `sift-sales-${opts.rows}-seed${opts.seed}`;
  void saveDatasetToProject(currentBuffers.xlsx, `${stamp}.xlsx`);
});

[rowsInput, seedInput, missingSelect, seasonalitySelect].forEach((el) => {
  el.addEventListener("change", regenerate);
});

// ============================================================
// СТАРТ
// ============================================================

regenerate();