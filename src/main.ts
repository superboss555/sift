import "./styles.css";

import {
  loadFile,
  orderOrdinalValues,
  type ParsedData,
  type ColumnType,
} from "./lib/loader.js";
import { collectMemoryStats, formatBytes } from "./lib/memory.js";
import {
  saveSession,
  loadSession,
  clearSession,
  sessionToFile,
} from "./lib/storage.js";

import {
  runProgressiveHistogram,
  runProgressiveBarChart,
  runProgressiveBucketedHistogram,
  runProgressiveGroupedHistogram,
    runProgressiveBoxPlot,
  type BoxPlotHandle,
  type BoxPlotChunkResult,
  type HistogramHandle,
  type HistogramChunkResult,
  type BarChartHandle,
  type BarChartChunkResult,
  type BucketedHistogramHandle,
  type BucketedHistogramChunkResult,
  type GroupedHistogramHandle,
  type GroupedHistogramChunkResult,
} from "./lib/sift-core.js";

import {
  HistogramRenderer,
  formatNumberPrecise,
} from "./lib/renderers/histogram-renderer.js";

import {
  BarChartRenderer,
  type BarChartCategory,
  type BarChartData,
} from "./lib/renderers/barchart-renderer.js";

import { GroupedHistogramRenderer } from "./lib/renderers/grouped-histogram-renderer.js";
import { GroupedBarChartRenderer } from "./lib/renderers/grouped-barchart-renderer.js";

import { BoxPlotRenderer } from "./lib/renderers/box-plot-renderer.js";

import {
  saveVizState,
  loadVizState,
  clearVizState,
  type VizState,
  type SerializedDataSlot,
} from "./lib/viz-storage.js";

// ============================================================
// УТИЛИТЫ И ВАЛИДАЦИЯ
// ============================================================

const ALLOWED_EXTENSIONS = ["csv", "xlsx", "xls"] as const;

function getExtension(filename: string): string {
  return filename.toLowerCase().split(".").pop() ?? "";
}

function isAllowedFile(file: File): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(
    getExtension(file.name),
  );
}

function showError(message: string) {
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
  window.setTimeout(() => {
    errorDiv.style.display = "none";
  }, 5000);
}

function rejectAnimation() {
  dropZone.classList.add("reject");
  window.setTimeout(() => dropZone.classList.remove("reject"), 500);
}

// ============================================================
// DOM-ЭЛЕМЕНТЫ
// ============================================================

const dropZone = document.getElementById("drop-zone") as HTMLDivElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const hasHeadersCheckbox = document.getElementById(
  "has-headers",
) as HTMLInputElement;
const resultDiv = document.getElementById("result") as HTMLDivElement;
const errorDiv = document.getElementById("error") as HTMLDivElement;
const currentFileBar = document.getElementById(
  "current-file-bar",
) as HTMLDivElement;
const currentFileNameEl = document.getElementById(
  "current-file-name",
) as HTMLSpanElement;
const newFileBtn = document.getElementById("new-file-btn") as HTMLButtonElement;
const headerModal = document.getElementById(
  "header-mode-modal",
) as HTMLDivElement;
const modalDrop = document.getElementById("modal-drop") as HTMLButtonElement;
const modalKeep = document.getElementById("modal-keep") as HTMLButtonElement;
const modalCancel = document.getElementById(
  "modal-cancel",
) as HTMLButtonElement;
const promoteModal = document.getElementById(
  "promote-headers-modal",
) as HTMLDivElement;
const promoteConfirm = document.getElementById(
  "promote-confirm",
) as HTMLButtonElement;
const promoteCancel = document.getElementById(
  "promote-cancel",
) as HTMLButtonElement;
const delimiterLabel = document.getElementById(
  "delimiter-label",
) as HTMLLabelElement;
const delimiterSelect = document.getElementById(
  "delimiter-select",
) as HTMLSelectElement;
const delimiterDetected = document.getElementById(
  "delimiter-detected",
) as HTMLSpanElement;

const pageUpload = document.getElementById("page-upload") as HTMLDivElement;
const pageVisualize = document.getElementById(
  "page-visualize",
) as HTMLDivElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const backBtn = document.getElementById("back-btn") as HTMLButtonElement;
const vizFileName = document.getElementById("viz-file-name") as HTMLSpanElement;
const togglePanelsBtn = document.getElementById(
  "toggle-panels-btn",
) as HTMLButtonElement;
const vizLayout = document.getElementById("viz-layout") as HTMLDivElement;
const columnsList = document.getElementById("columns-list") as HTMLUListElement;

// Прогресс в тулбаре
const toolbarProgress = document.getElementById(
  "toolbar-progress",
) as HTMLDivElement;
const toolbarProgressTime = document.getElementById(
  "toolbar-progress-time",
) as HTMLSpanElement;
const toolbarProgressBar = document.getElementById(
  "toolbar-progress-bar",
) as HTMLDivElement;
const toolbarProgressPct = document.getElementById(
  "toolbar-progress-pct",
) as HTMLSpanElement;

const settingsPanel = document.getElementById("settings-panel") as HTMLElement;
const settingsContent = document.getElementById(
  "settings-content",
) as HTMLElement;
const settingsPanelTitle = document.getElementById(
  "settings-panel-title",
) as HTMLElement;
const settingsCloseBtn = document.getElementById(
  "settings-close-btn",
) as HTMLButtonElement;

const vizCanvas = document.getElementById("viz-canvas") as HTMLDivElement;
const vizEmptyState = document.getElementById(
  "viz-empty-state",
) as HTMLDivElement;

// Кнопка и модалка «Открыть из проекта»
const loadFromProjectBtn = document.getElementById(
  "load-from-project-btn",
) as HTMLButtonElement;
const datasetModal = document.getElementById("dataset-modal") as HTMLDivElement;
const datasetModalList = document.getElementById(
  "dataset-modal-list",
) as HTMLDivElement;
const datasetModalCancel = document.getElementById(
  "dataset-modal-cancel",
) as HTMLButtonElement;
const datasetBrowserUp = document.getElementById(
  "dataset-browser-up",
) as HTMLButtonElement;
const datasetBrowserPath = document.getElementById(
  "dataset-browser-path",
) as HTMLElement;

const badRowsModal = document.getElementById(
  "bad-rows-modal",
) as HTMLDivElement;
const badRowsErrorsCount = document.getElementById(
  "bad-rows-errors-count",
) as HTMLSpanElement;
const badRowsWarningsCount = document.getElementById(
  "bad-rows-warnings-count",
) as HTMLSpanElement;
const badRowsErrorsTbody = document.getElementById(
  "bad-rows-tbody-errors",
) as HTMLTableSectionElement;
const badRowsWarningsTbody = document.getElementById(
  "bad-rows-tbody-warnings",
) as HTMLTableSectionElement;
const badRowsCancel = document.getElementById(
  "bad-rows-cancel",
) as HTMLButtonElement;

// Глобальный тултип для значков «?»
const infoTooltip = document.createElement("div");
infoTooltip.className = "info-tooltip hidden";
document.body.appendChild(infoTooltip);

function showInfoTooltip(target: HTMLElement) {
  const text = target.getAttribute("data-tooltip");
  if (!text) return;
  infoTooltip.textContent = text;
  infoTooltip.classList.remove("hidden");

  // Позиционируем: по умолчанию над значком, по центру
  const rect = target.getBoundingClientRect();
  const tipRect = infoTooltip.getBoundingClientRect();

  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.top - tipRect.height - 10;

  // Не вылезаем за края окна
  if (left < 8) left = 8;
  if (left + tipRect.width > window.innerWidth - 8) {
    left = window.innerWidth - tipRect.width - 8;
  }
  // Если сверху нет места — показываем снизу
  if (top < 8) {
    top = rect.bottom + 10;
  }

  infoTooltip.style.left = `${left}px`;
  infoTooltip.style.top = `${top}px`;
}

function hideInfoTooltip() {
  infoTooltip.classList.add("hidden");
}

// ============================================================
// СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ============================================================

let currentData: ParsedData | null = null;
let currentFileName = "";
let selectedColumnIndex: number | null = null;
let vizScreenInitialized = false;

// ---- Сортировка списка колонок ----
//
// "original"   — в порядке файла (по умолчанию)
// "az" / "za"  — по имени
// "type-asc"   — по группе типа, внутри группы A-Z
// "type-desc"  — по группе типа в обратном порядке, внутри группы Z-A
type ColumnsSortMode = "original" | "az" | "za" | "type-asc" | "type-desc";

const COLUMNS_SORT_STORAGE_KEY = "sift.columnsSortMode";

function loadColumnsSortMode(): ColumnsSortMode {
  try {
    const raw = localStorage.getItem(COLUMNS_SORT_STORAGE_KEY);
    if (
      raw === "original" ||
      raw === "az" ||
      raw === "za" ||
      raw === "type-asc" ||
      raw === "type-desc"
    ) {
      return raw;
    }
  } catch {
    /* localStorage может быть недоступен */
  }
  return "original";
}

function saveColumnsSortMode(mode: ColumnsSortMode): void {
  try {
    localStorage.setItem(COLUMNS_SORT_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

let columnsSortMode: ColumnsSortMode = loadColumnsSortMode();

/** Канонический порядок типов для режима "по типу". */
const COLUMN_TYPE_ORDER: ColumnType["type"][] = [
  "numeric",
  "ordinal",
  "boolean",
  "date",
  "datetime",
  "string",
  "mixed",
  "empty",
];

// ============================================================
// ЗАГРУЗКА ФАЙЛА
// ============================================================

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) handleFile(fileInput.files[0]);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () =>
  dropZone.classList.remove("dragover"),
);
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");

  if (e.dataTransfer?.files?.length) {
    handleFile(e.dataTransfer.files[0]);
    return;
  }

  showError(
    "Chrome блокирует drag из панели VS Code. Используйте кнопку «Открыть датасет из проекта» выше или перетащите файл из проводника Windows.",
  );
});

document.addEventListener("paste", (e) => {
  if (dropZone.style.display === "none") return;

  const items = e.clipboardData?.items;
  if (!items) return;

  let foundFile: File | null = null;
  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        foundFile = file;
        break;
      }
    }
  }

  if (foundFile) {
    e.preventDefault();
    handleFile(foundFile);
    return;
  }

  const text = e.clipboardData?.getData("text/plain");
  if (text && text.trim().length > 0) {
    e.preventDefault();
    showError(
      "Вставка текста не поддерживается. Скопируйте файл (.csv, .xlsx, .xls) в проводнике и вставьте через Ctrl+V.",
    );
    rejectAnimation();
  }
});

newFileBtn.addEventListener("click", async () => {
  await clearSession();
  await clearVizState();
  resetVizOptions();
  vizScreenInitialized = false;

  // Сортировку колонок НЕ сбрасываем: это пользовательское
  // предпочтение, оно живёт в localStorage и переносится между файлами.

  currentFileBar.style.display = "none";
  dropZone.style.display = "";
  loadFromProjectBtn.style.display = "";
  resultDiv.innerHTML = "";
  fileInput.value = "";
  delimiterSelect.value = "auto";
  delimiterDetected.textContent = "";

  nextBtn.style.display = "none";
  currentData = null;
  currentFileName = "";
});

hasHeadersCheckbox.addEventListener("change", async () => {
  const session = await loadSession();
  if (!session) return;

  const file = sessionToFile(session);
  const nowChecked = hasHeadersCheckbox.checked;

  if (nowChecked) {
    const mode = await askPromoteToHeaders();
    if (mode === "cancel") {
      hasHeadersCheckbox.checked = false;
      return;
    }
    await handleFile(file, true, false);
  } else {
    const mode = await askHeaderMode();
    if (mode === "cancel") {
      hasHeadersCheckbox.checked = true;
      return;
    }
    await handleFile(file, false, mode === "drop");
  }
});

delimiterSelect.addEventListener("change", async () => {
  const session = await loadSession();
  if (!session) return;

  const file = sessionToFile(session);
  await handleFile(
    file,
    hasHeadersCheckbox.checked,
    session.dropFirstRow,
    delimiterSelect.value,
  );
});

async function handleFile(
  file: File,
  overrideHeaders?: boolean,
  dropFirstRow: boolean = false,
  overrideDelimiter?: string,
) {
  if (!isAllowedFile(file)) {
    const ext = getExtension(file.name) || "(без расширения)";
    showError(
      `Формат «${ext}» не поддерживается. Разрешены: ${ALLOWED_EXTENSIONS.map((e) => "." + e).join(", ")}`,
    );
    rejectAnimation();
    return;
  }

  errorDiv.style.display = "none";

  const isFirstLoad = resultDiv.innerHTML.trim() === "";
  if (isFirstLoad) {
    resultDiv.innerHTML =
      '<p style="padding: 20px; color: #666;">Загрузка и парсинг…</p>';
  } else {
    resultDiv.classList.add("loading");
  }

  try {
    const delimiter = overrideDelimiter ?? (delimiterSelect.value as string);

    const data = await loadFile(file, {
      hasHeaders: overrideHeaders,
      dropFirstRow,
      delimiter,
    });

    hasHeadersCheckbox.checked = data.hasHeaders;

    if (data.sourceFormat === "csv") {
      delimiterLabel.classList.remove("hidden");
      delimiterSelect.value = data.delimiterAuto ? "auto" : data.delimiter;
      if (data.delimiterAuto && data.delimiter) {
        delimiterDetected.textContent = `→ "${visualizeDelimiter(data.delimiter)}"`;
      } else {
        delimiterDetected.textContent = "";
      }
    } else {
      delimiterLabel.classList.add("hidden");
      delimiterDetected.textContent = "";
    }

    await saveSession(
      file,
      data.hasHeaders,
      data.dropFirstRow,
      delimiterSelect.value,
    );

    dropZone.style.display = "none";
    loadFromProjectBtn.style.display = "none";
    currentFileBar.style.display = "flex";
    currentFileNameEl.textContent = file.name;

    renderResult(data, file);

    currentData = data;
    currentFileName = file.name;
    nextBtn.style.display = "inline-flex";
  } catch (err) {
    showError(`Ошибка: ${(err as Error).message}`);
    if (isFirstLoad) resultDiv.innerHTML = "";
  } finally {
    resultDiv.classList.remove("loading");
  }
}

// ============================================================
// ЗАГРУЗКА ФАЙЛА ИЗ ПРОЕКТА (dev-режим, файловый браузер)
// ============================================================

interface BrowserItem {
  name: string;
  type: "dir" | "file";
  path: string;
}
interface BrowserResponse {
  path: string;
  items: BrowserItem[];
}

let browserCurrentPath = "";

loadFromProjectBtn.addEventListener("click", () => {
  void navigateBrowser("public/datasets");
  openDatasetModal();
});

datasetModalCancel.addEventListener("click", closeDatasetModal);

datasetBrowserUp.addEventListener("click", () => {
  if (!browserCurrentPath) return;
  const parent = browserCurrentPath.split("/").slice(0, -1).join("/");
  void navigateBrowser(parent);
});

async function navigateBrowser(dir: string) {
  datasetModalList.innerHTML = `<div class="dataset-modal-empty">Загрузка…</div>`;
  datasetBrowserPath.textContent = "/" + dir;
  datasetBrowserUp.disabled = dir === "";

  let data: BrowserResponse;
  try {
    const res = await fetch(`/api/list-files?dir=${encodeURIComponent(dir)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as BrowserResponse;
  } catch (err) {
    datasetModalList.innerHTML = `
      <div class="dataset-modal-empty">
        Не удалось открыть папку: ${escapeHtml((err as Error).message)}
      </div>`;
    return;
  }

  browserCurrentPath = data.path;

  if (data.items.length === 0) {
    datasetModalList.innerHTML = `<div class="dataset-modal-empty">Папка пуста</div>`;
    return;
  }

  const allowedExt = /\.(csv|xlsx|xls)$/i;

  datasetModalList.innerHTML = data.items
    .map((it) => {
      if (it.type === "dir") {
        return `
          <div class="dataset-modal-item dir"
               data-type="dir"
               data-path="${escapeHtml(it.path)}">
            <span class="dataset-modal-name">${escapeHtml(it.name)}</span>
          </div>`;
      }
      const ok = allowedExt.test(it.name);
      return `
        <div class="dataset-modal-item file ${ok ? "" : "disabled"}"
             data-type="file"
             data-path="${escapeHtml(it.path)}"
             data-name="${escapeHtml(it.name)}"
             ${ok ? "" : 'title="Формат не поддерживается"'}>
          <span class="dataset-modal-name">${escapeHtml(it.name)}</span>
        </div>`;
    })
    .join("");

  datasetModalList
    .querySelectorAll<HTMLElement>(".dataset-modal-item")
    .forEach((el) => {
      el.addEventListener("click", () => {
        const type = el.getAttribute("data-type");
        const p = el.getAttribute("data-path") ?? "";

        if (type === "dir") {
          void navigateBrowser(p);
          return;
        }
        if (el.classList.contains("disabled")) return;

        const name =
          el.getAttribute("data-name") ?? p.split("/").pop() ?? "file";
        void loadFileFromProject(p, name);
      });
    });
}

async function loadFileFromProject(path: string, name: string) {
  closeDatasetModal();
  try {
    const res = await fetch(`/api/read-file?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], name, {
      type: blob.type || "application/octet-stream",
    });
    await handleFile(file);
  } catch (err) {
    showError(`Не удалось открыть ${name}: ${(err as Error).message}`);
  }
}

function openDatasetModal() {
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth;
  document.body.style.setProperty("--scrollbar-width", `${scrollbarWidth}px`);
  document.body.classList.add("modal-open");
  datasetModal.classList.add("open");
}

function closeDatasetModal() {
  datasetModal.classList.remove("open");
  document.body.classList.remove("modal-open");
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function visualizeDelimiter(d: string): string {
  if (d === "\t") return "\\t";
  if (d === ",") return ",";
  if (d === ";") return ";";
  if (d === "|") return "|";
  return d;
}

function askHeaderMode(): Promise<"drop" | "keep" | "cancel"> {
  return new Promise((resolve) => {
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.setProperty("--scrollbar-width", `${scrollbarWidth}px`);

    const savedScrollY = window.scrollY;

    document.body.classList.add("modal-open");
    headerModal.classList.add("open");

    const cleanup = () => {
      headerModal.classList.remove("open");
      document.body.classList.remove("modal-open");
      window.scrollTo({
        top: savedScrollY,
        behavior: "instant" as ScrollBehavior,
      });
      modalDrop.removeEventListener("click", onDrop);
      modalKeep.removeEventListener("click", onKeep);
      modalCancel.removeEventListener("click", onCancel);
    };

    const onDrop = () => {
      cleanup();
      resolve("drop");
    };
    const onKeep = () => {
      cleanup();
      resolve("keep");
    };
    const onCancel = () => {
      cleanup();
      resolve("cancel");
    };

    modalDrop.addEventListener("click", onDrop);
    modalKeep.addEventListener("click", onKeep);
    modalCancel.addEventListener("click", onCancel);
  });
}

function askPromoteToHeaders(): Promise<"promote" | "cancel"> {
  return new Promise((resolve) => {
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.setProperty("--scrollbar-width", `${scrollbarWidth}px`);
    const savedScrollY = window.scrollY;

    document.body.classList.add("modal-open");
    promoteModal.classList.add("open");

    const cleanup = () => {
      promoteModal.classList.remove("open");
      document.body.classList.remove("modal-open");
      window.scrollTo({
        top: savedScrollY,
        behavior: "instant" as ScrollBehavior,
      });
      promoteConfirm.removeEventListener("click", onConfirm);
      promoteCancel.removeEventListener("click", onCancel);
    };

    const onConfirm = () => {
      cleanup();
      resolve("promote");
    };
    const onCancel = () => {
      cleanup();
      resolve("cancel");
    };

    promoteConfirm.addEventListener("click", onConfirm);
    promoteCancel.addEventListener("click", onCancel);
  });
}

async function restoreSession() {
  try {
    const session = await loadSession();
    if (!session) return;

    hasHeadersCheckbox.checked = session.hasHeaders;
    delimiterSelect.value = session.delimiter || "auto";

    const file = sessionToFile(session);
    await handleFile(
      file,
      session.hasHeaders,
      session.dropFirstRow,
      session.delimiter,
    );

    if (!currentData) return;

    // Проверяем, есть ли сохранённое состояние визуализаций
    const vizState = await loadVizState();
    if (!vizState) return;
    if (vizState.fileName !== session.fileName) return;
    if (vizState.cards.length === 0) return;

    // Сразу открываем страницу 2 и восстанавливаем карточки
    pageUpload.classList.remove("active");
    pageVisualize.classList.add("active");
    vizFileName.textContent = currentFileName;

    renderColumnsList();
    renderVizOptions();
    updateColumnsAvailability();

    restoreVizState(vizState);

    vizScreenInitialized = true;

    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  } catch (err) {
    console.warn("Не удалось восстановить сессию:", err);
  }
}

// ============================================================
// РЕНДЕР СТРАНИЦЫ ЗАГРУЗКИ
// ============================================================

function renderResult(data: ParsedData, file: File) {
  const previewRows = data.rows.slice(0, 50);
  const mem = collectMemoryStats(file, data);
  const memoryRatio =
    mem.fileSize > 0 ? (mem.parsedSize / mem.fileSize).toFixed(1) : "—";

  const headersChip = data.hasHeaders
    ? `<span class="status-chip good"><span class="chip-label">заголовки:</span> первая строка</span>`
    : data.dropFirstRow
      ? `<span class="status-chip warn"><span class="chip-label">заголовки:</span> первая строка удалена</span>`
      : `<span class="status-chip warn"><span class="chip-label">заголовки:</span> первая строка в данных</span>`;

  const delimiterChip =
    data.sourceFormat === "csv"
      ? `<span class="status-chip info"><span class="chip-label">разделитель:</span> "${visualizeDelimiter(data.delimiter)}"${data.delimiterAuto ? " (авто)" : ""}</span>`
      : "";

  const numericCount = data.columnTypes.filter(
    (c) => c.type === "numeric",
  ).length;
  const typesChip = `<span class="status-chip info"><span class="chip-label">числовых колонок:</span> ${numericCount} из ${data.columnCount}</span>`;
  const rowsChip = `<span class="status-chip info"><span class="chip-label">строк данных:</span> ${data.rowCount.toLocaleString("ru-RU")}</span>`;

  const statusLine = document.getElementById("status-line") as HTMLDivElement;
  if (statusLine) {
    statusLine.innerHTML = headersChip + delimiterChip + typesChip + rowsChip;
  }

  const html = `
        <div class="card">
            <h3 class="card-title">Файл</h3>
            <div class="file-row">
                <div class="metric">
                    <span class="value">${data.rowCount.toLocaleString("ru-RU")}</span>
                    <span class="label">Строк</span>
                </div>
                <div class="metric">
                    <span class="value">${data.columnCount}</span>
                    <span class="label">Колонок</span>
                </div>
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Память</h3>
            <div class="memory-row">
                <div class="metric info">
                    <span class="value">${formatBytes(mem.fileSize)}</span>
                    <span class="label">Размер файла</span>
                </div>
                <div class="metric warn">
                    <span class="value">${formatBytes(mem.parsedSize)}</span>
                    <span class="label">Оценка в памяти ×${memoryRatio}</span>
                </div>
                <div class="metric">
                    <span class="value">${formatBytes(mem.numericCompactSize)}</span>
                    <span class="label">Числа в Float64Array</span>
                </div>
                ${
                  mem.heapUsed > 0
                    ? `
                    <div class="metric">
                        <span class="value">${formatBytes(mem.heapUsed)}</span>
                        <span class="label">JS Heap Used</span>
                    </div>
                `
                    : ""
                }
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Типы колонок</h3>
            <div class="columns">
                ${data.columnTypes
                  .map(
                    (ct) => `
                    <span class="column-badge ${ct.type}" title="Числовых значений: ${Math.round(ct.numericRatio * 100)}%">
                        ${ct.name} · ${ct.type}
                    </span>
                `,
                  )
                  .join("")}
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Предпросмотр ${previewRows.length < data.rowCount ? `— первые ${previewRows.length} из ${data.rowCount}` : ""}</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>${data.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
                    </thead>
                    <tbody>
                        ${previewRows
                          .map(
                            (row) => `
                            <tr>${row.map((cell) => `<td>${cell == null ? "" : escapeHtml(String(cell))}</td>`).join("")}</tr>
                        `,
                          )
                          .join("")}
                    </tbody>
                </table>
            </div>
        </div>
    `;

  resultDiv.innerHTML = html;
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

function formatNumberRu(x: number): string {
  if (!isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a >= 1e6 || (a > 0 && a < 1e-3)) return x.toExponential(2);
  if (Number.isInteger(x)) return x.toLocaleString("ru-RU");
  if (a >= 100) return x.toFixed(1);
  return x.toFixed(2);
}

// ============================================================
// НАВИГАЦИЯ МЕЖДУ СТРАНИЦАМИ
// ============================================================

nextBtn.addEventListener("click", () => {
  if (!currentData) return;

  pageUpload.classList.remove("active");
  pageVisualize.classList.add("active");

  vizFileName.textContent = currentFileName;

  renderColumnsList();

  if (!vizScreenInitialized) {
    // Первый переход на страницу 2 — сбрасываем состояние и создаём лист
    resetVizOptions();
    vizScreenInitialized = true;
  } else {
    // Уже были здесь — обновляем доступность колонок
    updateColumnsAvailability();
  }

  // Если по какой-то причине листов нет — создаём первый
  if (sheets.length === 0) {
    createSheet();
  }

  window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
});
backBtn.addEventListener("click", () => {
  pageVisualize.classList.remove("active");
  pageUpload.classList.add("active");
});

togglePanelsBtn.addEventListener("click", () => {
  const hidden = vizLayout.classList.toggle("panels-hidden");
  togglePanelsBtn.textContent = hidden ? "Показать панели" : "Скрыть панели";
  scheduleSaveVizState();
});

// ============================================================
// СПИСОК КОЛОНОК
// ============================================================

function renderColumnsList() {
  if (!currentData) return;

  ensureColumnsToolbar();

  const sorted = sortColumnEntries(currentData.columnTypes);

  columnsList.innerHTML = sorted
    .map(
      ({ ct, idx }) => `
        <li data-index="${idx}" class="${ct.type}">
            ${escapeHtml(ct.name)}
        </li>
    `,
    )
    .join("");

  columnsList.querySelectorAll("li").forEach((li) => {
    const idx = Number(li.getAttribute("data-index"));

    li.setAttribute("draggable", "true");
    li.addEventListener("dragstart", (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData("application/x-sift-column", String(idx));
        e.dataTransfer.effectAllowed = "copy";
      }
    });

    li.addEventListener("click", () => {
      selectColumn(idx);
    });

    // Восстанавливаем выделение после пересортировки
    if (selectedColumnIndex !== null && idx === selectedColumnIndex) {
      li.classList.add("selected");
    }
  });

  updateColumnsAvailability();
}

/**
 * Возвращает массив { ct, idx } в порядке, заданном columnsSortMode.
 * idx — исходный индекс в currentData.columnTypes, нужен для
 * drag-and-drop и валидации совместимости.
 */
function sortColumnEntries(
  columnTypes: ColumnType[],
): { ct: ColumnType; idx: number }[] {
  const items = columnTypes.map((ct, idx) => ({ ct, idx }));
  if (columnsSortMode === "original") return items;

  const cmpRu = (a: string, b: string) => a.localeCompare(b, "ru");
  const arr = [...items];

  switch (columnsSortMode) {
    case "az":
      arr.sort((a, b) => cmpRu(a.ct.name, b.ct.name));
      break;

    case "za":
      arr.sort((a, b) => cmpRu(b.ct.name, a.ct.name));
      break;

    case "type-asc":
    case "type-desc": {
      // Порядок ГРУПП типов всегда одинаковый (numeric → ordinal → ...).
      // Меняется только направление сортировки имён ВНУТРИ группы.
      const nameDir = columnsSortMode === "type-asc" ? 1 : -1;
      arr.sort((a, b) => {
        const ai = COLUMN_TYPE_ORDER.indexOf(a.ct.type);
        const bi = COLUMN_TYPE_ORDER.indexOf(b.ct.type);
        if (ai !== bi) return ai - bi; // порядок групп фиксирован
        return cmpRu(a.ct.name, b.ct.name) * nameDir; // направление имён
      });
      break;
    }
  }

  return arr;
}

// ------------------------------------------------------------
// ТУЛБАР СОРТИРОВКИ НАД СПИСКОМ КОЛОНОК
// ------------------------------------------------------------

function ensureColumnsToolbar(): void {
  if (document.getElementById("columns-toolbar")) return;

  const toolbar = document.createElement("div");
  toolbar.id = "columns-toolbar";
  toolbar.className = "columns-toolbar";
  toolbar.innerHTML = `
    <select class="columns-sort-select" id="columns-sort-select"
            title="Сортировка списка колонок">
      <option value="original">Исходный</option>
      <option value="az">A → Я</option>
      <option value="za">Я → A</option>
      <option value="type-asc">По типу ↑</option>
      <option value="type-desc">По типу ↓</option>
    </select>
  `;

  columnsList.parentElement?.insertBefore(toolbar, columnsList);

  const select = toolbar.querySelector(
    "#columns-sort-select",
  ) as HTMLSelectElement;
  select.value = columnsSortMode;

  select.addEventListener("change", () => {
    columnsSortMode = select.value as ColumnsSortMode;
    saveColumnsSortMode(columnsSortMode);
    renderColumnsList();
  });
}

function selectColumn(index: number) {
  if (!currentData) return;

  if (!activeCardId) return;

  if (!isColumnCompatible(index)) {
    const li = columnsList.querySelector(`li[data-index="${index}"]`);
    if (li) {
      li.classList.add("reject");
      setTimeout(() => li.classList.remove("reject"), 400);
    }
    return;
  }

  selectedColumnIndex = index;

  columnsList.querySelectorAll("li").forEach((li) => {
    li.classList.toggle(
      "selected",
      Number(li.getAttribute("data-index")) === index,
    );
  });
}

function isColumnCompatible(columnIndex: number): boolean {
  if (!currentData || !activeCardId) return true;

  const card = vizCards.find((c) => c.id === activeCardId);
  if (!card) return true;

  const viz = VIZ_OPTIONS.find((v) => v.id === card.vizId);
  if (!viz) return true;

  const colType = currentData.columnTypes[columnIndex].type;
  return viz.types.includes(colType);
}

function updateColumnsAvailability() {
  if (!currentData) return;

  if (!activeCardId) {
    columnsList.querySelectorAll("li").forEach((li) => {
      li.classList.remove("incompatible");
    });
    return;
  }

  columnsList.querySelectorAll("li").forEach((li) => {
    const idx = Number(li.getAttribute("data-index"));
    const compatible = isColumnCompatible(idx);
    li.classList.toggle("incompatible", !compatible);
  });
}

// ============================================================
// ПАНЕЛЬ ВИЗУАЛИЗАЦИЙ
// ============================================================

interface VizOption {
  id: string;
  label: string;
  types: string[];
  section: "histogram" | "barchart" | "other";
  /** Готов ли к использованию. Иначе — заглушка «скоро». */
  enabled: boolean;
  icon: string;
  /** Заголовок карточки по умолчанию. Если не задан — берётся label. */
  defaultTitle?: string;
}

const VIZ_OPTIONS: VizOption[] = [
  // ============ ГИСТОГРАММЫ ============
  {
    id: "histogram",
    label: "С бинами",
    types: ["numeric"],
    section: "histogram",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="20" x2="4" y2="14"/>
            <line x1="9" y1="20" x2="9" y2="8"/>
            <line x1="14" y1="20" x2="14" y2="4"/>
            <line x1="19" y1="20" x2="19" y2="12"/>
            <line x1="2" y1="21" x2="22" y2="21"/>
        </svg>`,
  },
  {
    id: "histogram-buckets",
    label: "С диапазонами",
    defaultTitle: "Гистограмма с диапазонами",
    types: ["numeric"],
    section: "histogram",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="14" width="5" height="6"/>
            <rect x="9" y="8" width="5" height="12"/>
            <rect x="15" y="4" width="6" height="16"/>
            <line x1="2" y1="21" x2="22" y2="21"/>
        </svg>`,
  },
  {
    id: "histogram-grouped",
    label: "С накоплением",
    defaultTitle: "Гистограмма с группировкой",
    // Карточке нужны оба типа: numeric (значения) + категориальный (группировка).
    types: [
      "numeric",
      "string",
      "mixed",
      "boolean",
      "date",
      "datetime",
      "ordinal",
    ],
    section: "histogram",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="20" x2="4" y2="12"/>
            <line x1="6" y1="20" x2="6" y2="16"/>
            <line x1="11" y1="20" x2="11" y2="8"/>
            <line x1="13" y1="20" x2="13" y2="13"/>
            <line x1="18" y1="20" x2="18" y2="5"/>
            <line x1="20" y1="20" x2="20" y2="10"/>
            <line x1="2" y1="21" x2="22" y2="21"/>
        </svg>`,
  },

  // ============ ЛИНЕЙЧАТЫЕ ============
  {
    id: "barchart",
    label: "С бинами",
    types: ["numeric"],
    section: "barchart",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="6" x2="14" y2="6"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="10" y2="18"/>
        </svg>`,
  },
  {
    id: "barchart-buckets",
    label: "С диапазонами",
    defaultTitle: "Линейчатая с диапазонами",
    types: ["numeric"],
    section: "barchart",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="5" x2="18" y2="5"/>
            <line x1="4" y1="10" x2="12" y2="10"/>
            <line x1="4" y1="15" x2="20" y2="15"/>
            <line x1="4" y1="20" x2="15" y2="20"/>
        </svg>`,
  },
  {
    id: "barchart-grouped",
    label: "С накоплением",
    defaultTitle: "Линейчатая с группировкой",
    types: [
      "numeric",
      "string",
      "mixed",
      "boolean",
      "date",
      "datetime",
      "ordinal",
    ],
    section: "barchart",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="5" x2="20" y2="5"/>
            <line x1="4" y1="6.5" x2="14" y2="6.5"/>
            <line x1="4" y1="11" x2="20" y2="11"/>
            <line x1="4" y1="12.5" x2="10" y2="12.5"/>
            <line x1="4" y1="17" x2="20" y2="17"/>
            <line x1="4" y1="18.5" x2="16" y2="18.5"/>
        </svg>`,
  },

  // ============ ДРУГОЕ ============
  {
    id: "boxplot",
    label: "Box plot",
    types: ["numeric"],
    section: "other",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="3" x2="12" y2="7"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <rect x="7" y="7" width="10" height="10" rx="1"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>`,
  },
  {
    id: "piechart",
    label: "Круговая",
    types: ["string", "mixed", "boolean", "date", "datetime", "ordinal"],
    section: "other",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>
            <path d="M22 12A10 10 0 0 0 12 2v10z"/>
        </svg>`,
  },
  {
    id: "summary",
    label: "Сводка",
    types: ["numeric"],
    section: "other",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>`,
  },

  // Фиктивный элемент — реальная карточка-легенда, но создаётся не через
  // панель визуализаций, а по клику на бейдж «Легенда N» в шапке grouped-
  // диаграммы. В панели иконок не отображается.
  {
    id: "legend",
    label: "Легенда",
    types: [],
    section: "other",
    enabled: false,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    defaultTitle: "Легенда",
  },
];

const VIZ_TEMPLATES: Record<string, string> = {
  boxplot: `
        <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet">
            <line x1="200" y1="30" x2="200" y2="230" stroke="#c8cfd8" stroke-width="2"/>
            <line x1="160" y1="60" x2="240" y2="60" stroke="#4a9eff" stroke-width="2"/>
            <line x1="160" y1="200" x2="240" y2="200" stroke="#4a9eff" stroke-width="2"/>
            <rect x="140" y="90" width="120" height="80" fill="#e6f2ff" stroke="#4a9eff" stroke-width="2" stroke-dasharray="6 4"/>
            <line x1="140" y1="130" x2="260" y2="130" stroke="#4a9eff" stroke-width="2"/>
            <text x="200" y="250" text-anchor="middle" font-size="12" fill="#94a3b8">Распределение</text>
        </svg>
    `,
  piechart: `
        <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet">
            <circle cx="200" cy="130" r="90" fill="none" stroke="#4a9eff" stroke-width="2" stroke-dasharray="6 4"/>
            <line x1="200" y1="130" x2="200" y2="40" stroke="#c8cfd8" stroke-width="1.5"/>
            <line x1="200" y1="130" x2="270" y2="190" stroke="#c8cfd8" stroke-width="1.5"/>
        </svg>
    `,
  summary: `
        <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet">
            <text x="60" y="50" font-size="13" fill="#94a3b8">Среднее:</text>
            <line x1="150" y1="44" x2="340" y2="44" stroke="#c8cfd8" stroke-width="1.5" stroke-dasharray="4 3"/>
            <text x="60" y="100" font-size="13" fill="#94a3b8">Медиана:</text>
            <line x1="150" y1="94" x2="340" y2="94" stroke="#c8cfd8" stroke-width="1.5" stroke-dasharray="4 3"/>
            <text x="60" y="150" font-size="13" fill="#94a3b8">Ст. откл.:</text>
            <line x1="150" y1="144" x2="340" y2="144" stroke="#c8cfd8" stroke-width="1.5" stroke-dasharray="4 3"/>
            <text x="60" y="200" font-size="13" fill="#94a3b8">Мин / Макс:</text>
            <line x1="150" y1="194" x2="340" y2="194" stroke="#c8cfd8" stroke-width="1.5" stroke-dasharray="4 3"/>
        </svg>
    `,
};

// ============================================================
// ТИПЫ НАСТРОЕК КАРТОЧКИ
// ============================================================

interface DataSlot {
  columnIndex: number;
  name: string;
  legendText: string;
}

type BucketOperator =
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "eq"
  | "neq"
  | "range"
  | "other";

interface Bucket {
  id: string;
  name: string;
  operator: BucketOperator;
  value1: number | null;
  value2: number | null;
}

interface CardSettings {
  title: string;
  showLegend: boolean;
  showAxisLabels: boolean;
  legendText: string;
  slots: [DataSlot | null, DataSlot | null];
  bins: number;
  yLabelOverride: string;
  topN: number;
  showGrid: boolean;
  /** Знаков после запятой в подписях осей. 0 = целые. */
  precision: number;
  /** Группы для гистограммы/линейчатой с диапазонами. */
  buckets: Bucket[];
  /** Показывать на оси название группы или её условие. */
  bucketsShowName: boolean;

  /** Режим отрисовки для группированной гистограммы. */
  renderMode: "grouped" | "stacked";
}

// ============================================================
// ДИНАМИЧЕСКИЙ РЕНДЕР ТЕЛА КАРТОЧКИ (SVG-заглушки)
// ============================================================

const DEFAULT_AXIS_LABELS: Record<string, [string, string]> = {
  histogram: ["Значения", "Частота"],
  barchart: ["", ""],
  boxplot: ["Значения", ""],
};

function getAxisLabel(
  slot: DataSlot | null,
  placeholder: string,
  showLegend: boolean,
): string {
  if (!slot) return placeholder;
  if (!showLegend) return "";
  return slot.legendText.trim();
}

function buildVizSVG(card: VizCard): string {
  const [slot0, slot1] = card.settings.slots;
  const showLegend = card.settings.showLegend;
  const defaults = DEFAULT_AXIS_LABELS[card.vizId] ?? ["", ""];

  if (card.vizId === "histogram") {
    const xLabel = getAxisLabel(slot0, defaults[0], showLegend);
    const yLabel = getAxisLabel(slot0, defaults[1], showLegend);
    return buildHistogramSVG(xLabel, yLabel);
  }
  if (card.vizId === "barchart") {
    const showAxis = card.settings.showAxisLabels;
    const xLabel = showAxis ? card.settings.yLabelOverride.trim() : "";
    const yLabel = showAxis ? slot0?.legendText || "" : "";
    return buildBarchartSVG(xLabel, yLabel);
  }

  return VIZ_TEMPLATES[card.vizId] ?? "";
}

function buildHistogramSVG(xLabel: string, yLabel: string): string {
  const xText = xLabel
    ? `<text x="210" y="250" text-anchor="middle" font-size="12" fill="#94a3b8">${escapeHtml(xLabel)}</text>`
    : "";
  const yText = yLabel
    ? `<text x="20" y="130" text-anchor="middle" font-size="12" fill="#94a3b8" transform="rotate(-90 20 130)">${escapeHtml(yLabel)}</text>`
    : "";

  return `
    <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet">
      <line x1="40" y1="220" x2="380" y2="220" stroke="#c8cfd8" stroke-width="2"/>
      <line x1="40" y1="40" x2="40" y2="220" stroke="#c8cfd8" stroke-width="2"/>
      ${xText}
      ${yText}
    </svg>
  `;
}

function buildBarchartSVG(xLabel: string, yLabel: string): string {
  const xText = xLabel
    ? `<text x="250" y="252" text-anchor="middle" font-size="12" fill="#94a3b8">${escapeHtml(xLabel)}</text>`
    : "";
  const yText = yLabel
    ? `<text x="105" y="135" text-anchor="middle" font-size="12" fill="#94a3b8" transform="rotate(-90 105 135)">${escapeHtml(yLabel)}</text>`
    : "";

  return `
    <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet">
      <line x1="120" y1="30" x2="120" y2="240" stroke="#c8cfd8" stroke-width="2"/>
      <line x1="120" y1="240" x2="380" y2="240" stroke="#c8cfd8" stroke-width="2"/>
      ${xText}
      ${yText}
    </svg>
  `;
}

function refreshCardBody(card: VizCard) {
  const el = document.getElementById(card.id);
  if (!el) return;
  const body = el.querySelector(".viz-card-body");
  if (!body) return;
  body.innerHTML = buildVizSVG(card);
}

function updateCardTitle(card: VizCard) {
  const el = document.getElementById(card.id);
  if (!el) return;
  const viz = VIZ_OPTIONS.find((v) => v.id === card.vizId);
  const titleEl = el.querySelector(".viz-card-title");
  if (titleEl) {
    titleEl.textContent = card.settings.title.trim() || (viz?.label ?? "");
  }
}

// ============================================================
// ТИПЫ И СОСТОЯНИЕ КАРТОЧЕК / ЛИСТОВ
// ============================================================
//
// Объявления перенесены выше collectVizState / restoreVizState,
// чтобы эти функции могли ссылаться на переменные до их фактического
// места определения в файле.

interface VizCard {
  id: string;
  vizId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  settings: CardSettings;
  /** Только для vizId === "legend": id диаграммы, к которой привязана легенда. */
  linkedCardId?: string;
}

interface Sheet {
  id: string;
  name: string;
  cards: VizCard[];
  activeCardId: string | null;
}

interface SerializedSheet {
  id: string;
  name: string;
  cards: any[]; // SerializedCard[]
  activeCardId: string | null;
}

let vizCards: VizCard[] = [];
let activeCardId: string | null = null;
let cardCounter = 0;

const legendBadges = new Map<string, LegendBadgeHandle>();

let sheets: Sheet[] = [];
let activeSheetId = "";
const sheetLayers = new Map<string, HTMLElement>();
let sheetCounter = 0;

function getCurrentSheet(): Sheet | null {
  return sheets.find((s) => s.id === activeSheetId) ?? null;
}

function ensureSheetLayer(sheetId: string): HTMLElement {
  let layer = sheetLayers.get(sheetId);
  if (layer && vizCanvas.contains(layer)) return layer;

  layer = document.createElement("div");
  layer.className = "viz-sheet-layer";
  layer.dataset.sheetId = sheetId;
  vizCanvas.appendChild(layer);
  sheetLayers.set(sheetId, layer);
  return layer;
}

function showSheetLayer(sheetId: string): void {
  for (const [id, layer] of sheetLayers) {
    layer.style.display = id === sheetId ? "" : "none";
  }
}

// ============================================================
// СЕРИАЛИЗАЦИЯ КАРТОЧКИ
// ============================================================

function serializeCard(c: VizCard): any {
  return {
    id: c.id,
    vizId: c.vizId,
    x: c.x,
    y: c.y,
    width: c.width,
    height: c.height,
    settings: {
      title: c.settings.title,
      showLegend: c.settings.showLegend,
      showAxisLabels: c.settings.showAxisLabels,
      legendText: c.settings.legendText,
      slots: [
        c.settings.slots[0] ? { ...c.settings.slots[0] } : null,
        c.settings.slots[1] ? { ...c.settings.slots[1] } : null,
      ],
      bins: c.settings.bins,
      yLabelOverride: c.settings.yLabelOverride,
      topN: c.settings.topN,
      showGrid: c.settings.showGrid,
      precision: c.settings.precision,
      buckets: c.settings.buckets.map((b: Bucket) => ({ ...b })),
      bucketsShowName: c.settings.bucketsShowName,
      renderMode: c.settings.renderMode,
      ...(c.linkedCardId !== undefined && { linkedCardId: c.linkedCardId }),
    },
  };
}

function collectVizState(): VizState | null {
  if (!currentFileName) return null;

  // Синхронизируем activeCardId текущего листа
  const currentSheet = getCurrentSheet();
  if (currentSheet) currentSheet.activeCardId = activeCardId;

  const serializedSheets: SerializedSheet[] = sheets.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    activeCardId: sheet.activeCardId,
    cards: sheet.cards.map(serializeCard),
  }));

  return {
    fileName: currentFileName,
    savedAt: Date.now(),
    // legacy-поле для обратной совместимости
    cards: serializedSheets.flatMap((s) => s.cards),
    activeCardId,
    cardCounter,
    // новые поля
    sheets: serializedSheets,
    activeSheetId,
    sheetCounter,
    panelsHidden: vizLayout.classList.contains("panels-hidden"),
    settingsPanelOpen: settingsPanel.classList.contains("open"),
  } as any;
}

let saveVizTimer: number | null = null;

/** Дебаунс: сохраняем не чаще, чем раз в 400 мс. */
function scheduleSaveVizState() {
  if (saveVizTimer !== null) window.clearTimeout(saveVizTimer);
  saveVizTimer = window.setTimeout(() => {
    saveVizTimer = null;
    void persistVizState();
  }, 400);
}

async function persistVizState() {
  const state = collectVizState();
  if (!state) return;
  try {
    if (state.cards.length === 0) {
      await clearVizState();
    } else {
      await saveVizState(state);
    }
  } catch (err) {
    console.warn("[viz] не удалось сохранить состояние:", err);
  }
}

/** Восстанавливает карточки из сохранённого состояния. */
function restoreVizState(state: VizState) {
  const extended = state as any;

  // Чистим текущее
    for (const id of [...runningBoxPlots.keys()]) stopBoxPlotForCard(id);
  for (const id of [...runningHistograms.keys()]) stopHistogramForCard(id);
  for (const id of [...runningBars.keys()]) stopBarChartForCard(id);
  for (const id of [...runningBucketedHistograms.keys()])
    stopBucketedHistogramForCard(id);
  for (const id of [...runningBucketedBars.keys()])
    stopBucketedBarChartForCard(id);

  for (const layer of sheetLayers.values()) layer.remove();
  sheetLayers.clear();


  vizCards = [];
  sheets = [];
  activeCardId = null;
  activeSheetId = "";
  sheetCounter = 0;
  legendBadges.clear();
  vizCanvas.querySelectorAll(".viz-card").forEach((el) => el.remove());
  clearGuides();
  vizEmptyState.style.display = "";

  // Формат: новый (sheets) или legacy (cards в одном листе)
  const serializedSheets: SerializedSheet[] = extended.sheets
    ? extended.sheets
    : [
        {
          id: "sheet-1",
          name: "Лист 1",
          cards: state.cards || [],
          activeCardId: state.activeCardId ?? null,
        },
      ];

  sheetCounter = extended.sheetCounter || serializedSheets.length;

  // Создаём записи листов + их DOM-слои
  for (const ss of serializedSheets) {
    const sheet: Sheet = {
      id: ss.id,
      name: ss.name,
      cards: [],
      activeCardId: ss.activeCardId,
    };
    sheets.push(sheet);
    ensureSheetLayer(ss.id);

    const m = ss.id.match(/^sheet-(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > sheetCounter) sheetCounter = n;
    }
  }

  // Определяем активный лист
  const targetActiveSheetId =
    extended.activeSheetId &&
    sheets.some((s) => s.id === extended.activeSheetId)
      ? extended.activeSheetId
      : sheets[0].id;
  activeSheetId = targetActiveSheetId;
  const activeSheet = sheets.find((s) => s.id === targetActiveSheetId)!;
  vizCards = activeSheet.cards; // ссылка

  // Восстанавливаем счётчик id карточек
  cardCounter = state.cardCounter || 0;
  for (const sc of state.cards) {
    const m = sc.id.match(/^viz-card-(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > cardCounter) cardCounter = n;
    }
  }

  // Восстанавливаем карточки по листам. Для каждого листа — два прохода:
  //   1) обычные диаграммы,
  //   2) карточки-легенды (ссылаются на диаграммы по linkedCardId).
  const restoreCardInto = (sc: any, sheet: Sheet): void => {
    // Проверяем, что колонки в слотах существуют в текущем датасете
    const fixedSlots: [SerializedDataSlot | null, SerializedDataSlot | null] = [
      null,
      null,
    ];
    for (let i = 0; i < 2; ++i) {
      const slot = sc.settings.slots[i];
      if (!slot) continue;
      if (!currentData) continue;
      const ct = currentData.columnTypes[slot.columnIndex];
      if (!ct) continue;
      fixedSlots[i] = {
        columnIndex: slot.columnIndex,
        name: ct.name,
        legendText: slot.legendText,
      };
    }

    const linkedCardId =
      sc.vizId === "legend"
        ? ((sc.settings as any).linkedCardId as string | undefined)
        : undefined;

    const card: VizCard = {
      id: sc.id,
      vizId: sc.vizId,
      x: sc.x,
      y: sc.y,
      width: sc.width,
      height: sc.height,
      linkedCardId,
      settings: {
        title: sc.settings.title,
        showLegend: sc.settings.showLegend ?? false,
        showAxisLabels: sc.settings.showAxisLabels ?? true,
        legendText: sc.settings.legendText ?? "",
        slots: fixedSlots,
        bins: sc.settings.bins,
        yLabelOverride: sc.settings.yLabelOverride,
        topN: sc.settings.topN,
        showGrid: sc.settings.showGrid ?? true,
        precision: sc.settings.precision ?? 0,
        buckets:
          sc.settings.buckets && sc.settings.buckets.length > 0
            ? (sc.settings.buckets as Bucket[]).map((b: Bucket) => ({
                id: b.id,
                name: b.name,
                operator: b.operator,
                value1: b.value1,
                value2: b.value2,
              }))
            : [makeDefaultBucket(0)],
        bucketsShowName: sc.settings.bucketsShowName ?? true,
        renderMode:
          (sc.settings as { renderMode?: "grouped" | "stacked" }).renderMode ??
          "grouped",
      },
    };
    sheet.cards.push(card);
    createCardElement(card, sheet.id);
    if (sheet.id === activeSheetId) {
      vizEmptyState.style.display = "none";
    }
    syncCardVisual(card);
  };

  // Восстанавливаем каждый лист
  for (const ss of serializedSheets) {
    const sheet = sheets.find((s) => s.id === ss.id);
    if (!sheet) continue;

    // Проход 1: обычные диаграммы
    for (const sc of ss.cards) {
      if (sc.vizId === "legend") continue;
      restoreCardInto(sc, sheet);
    }
    // Проход 2: карточки-легенды
    for (const sc of ss.cards) {
      if (sc.vizId !== "legend") continue;
      const link = sc.settings?.linkedCardId as string | undefined;
      if (!link || !sheet.cards.some((c) => c.id === link)) continue;
      restoreCardInto(sc, sheet);
    }
  }

  // Принудительно перерисовываем тела легенд — исходные диаграммы
  // могли ещё не успеть посчитать себя.
  for (const sheet of sheets) {
    for (const c of sheet.cards) {
      if (c.vizId === "legend") renderLegendCardBody(c);
    }
  }

  // Показываем активный лист
  showSheetLayer(activeSheetId);

  // Восстанавливаем панели
  if (extended.panelsHidden) {
    vizLayout.classList.add("panels-hidden");
    togglePanelsBtn.textContent = "Показать панели";
  } else {
    vizLayout.classList.remove("panels-hidden");
    togglePanelsBtn.textContent = "Скрыть панели";
  }

  // Активная карточка текущего листа
  const currentSheet = sheets.find((s) => s.id === activeSheetId);
  if (currentSheet?.activeCardId) {
    activeCardId = currentSheet.activeCardId;
    vizCanvas.querySelectorAll(".viz-card").forEach((el) => {
      el.classList.toggle("active", el.id === activeCardId);
    });
    if (extended.settingsPanelOpen) {
      settingsPanel.classList.add("open");
      renderSettingsContent(activeCardId);
    }
  }

  // Empty state для активного листа
  if (currentSheet) {
    vizEmptyState.style.display = currentSheet.cards.length === 0 ? "" : "none";
  }

  renderSheetTabs();
  updateColumnsAvailability();
  updateProgressUI();
}

// ============================================================
// СИСТЕМА КАРТОЧЕК В РАБОЧЕМ ПРОСТРАНСТВЕ
// ============================================================

interface SnapCandidate {
  value: number;
  guideAt: number;
  refCard?: VizCard;
  type: "position" | "size";
}

interface GuideSegment {
  orientation: "v" | "h";
  at: number;
  from: number;
  to: number;
  kind: "position" | "size";
}

const MIN_CARD_WIDTH = 280;
const MIN_CARD_HEIGHT = 200;
const CARD_GAP = 12;
const WORKSPACE_PADDING = 10;
const SNAP_THRESHOLD = 6;
const GUIDE_PADDING = 8;

// ============================================================
// ТРЕКЕР ПРОГРЕССА ОБРАБОТКИ
// ============================================================
//
// Один run на карточку. Индикатор в тулбаре переключается так:
//   1) Если активная карточка имеет run — её прогресс и её время.
//   2) Иначе, если есть активные обработки — суммарный прогресс
//      и время с начала самой ранней обработки.
//   3) Иначе — время последней завершённой, 100%.
//   4) Когда runs пусты — тулбар скрыт.

interface ProgressRun {
  processed: number;
  total: number;
  startedAt: number;
  finishedAt: number | null;
}

const progressRuns = new Map<string, ProgressRun>();
let progressRafHandle = 0;

function registerProgressRun(runId: string, total: number) {
  progressRuns.set(runId, {
    processed: 0,
    total,
    startedAt: performance.now(),
    finishedAt: null,
  });
  ensureProgressTick();
  updateProgressUI();
}

function updateProgressRun(runId: string, processed: number, total?: number) {
  const run = progressRuns.get(runId);
  if (!run) return;
  run.processed = processed;
  if (total !== undefined) run.total = total;
}

/** Помечает run завершённым, но оставляет в map — чтобы показать финальное время. */
function finishProgressRun(runId: string) {
  const run = progressRuns.get(runId);
  if (!run) return;
  run.processed = run.total;
  run.finishedAt = performance.now();
  updateProgressUI();
}

/** Удаляет run целиком (при закрытии карточки, смене колонки и т.п.). */
function unregisterProgressRun(runId: string) {
  progressRuns.delete(runId);
  updateProgressUI();
}

function resetProgress() {
  progressRuns.clear();
  if (progressRafHandle) {
    cancelAnimationFrame(progressRafHandle);
    progressRafHandle = 0;
  }
  updateProgressUI();
}

function ensureProgressTick() {
  if (progressRafHandle) return;
  const tick = () => {
    updateProgressUI();
    const hasActive = Array.from(progressRuns.values()).some(
      (r) => r.finishedAt === null,
    );
    progressRafHandle = hasActive ? requestAnimationFrame(tick) : 0;
  };
  progressRafHandle = requestAnimationFrame(tick);
}

function updateProgressUI() {
  if (progressRuns.size === 0) {
    toolbarProgress.style.display = "none";
    return;
  }

  toolbarProgress.style.display = "flex";

  // 1. Активная карточка и у неё есть run
  if (activeCardId) {
    const activeRun = progressRuns.get(activeCardId);
    if (activeRun) {
      renderSingleRun(activeRun);
      return;
    }
  }

  // 2. Есть активные runs — суммарный
  const allRuns = Array.from(progressRuns.values());
  const activeRuns = allRuns.filter((r) => r.finishedAt === null);
  if (activeRuns.length > 0) {
    renderAggregateRun(activeRuns);
    return;
  }

  // 3. Всё завершено — последняя завершённая
  const latest = allRuns.reduce((a, b) =>
    (a.finishedAt ?? 0) > (b.finishedAt ?? 0) ? a : b,
  );
  renderSingleRun(latest);
}

function renderSingleRun(run: ProgressRun) {
  const isLive = run.finishedAt === null;
  const pct = run.total > 0 ? Math.min(1, run.processed / run.total) : 0;
  const endTime = run.finishedAt ?? performance.now();
  const elapsed = Math.max(0, endTime - run.startedAt);

  toolbarProgressTime.textContent = formatDuration(elapsed);
  toolbarProgressBar.style.width = `${(pct * 100).toFixed(1)}%`;
  toolbarProgressPct.textContent = `${(pct * 100).toFixed(1)}%`;
  toolbarProgress.classList.toggle("live", isLive);
}

function renderAggregateRun(runs: ProgressRun[]) {
  let totalAll = 0;
  let processedAll = 0;
  let earliest = Infinity;

  for (const r of runs) {
    totalAll += r.total;
    processedAll += r.processed;
    if (r.startedAt < earliest) earliest = r.startedAt;
  }

  const pct = totalAll > 0 ? Math.min(1, processedAll / totalAll) : 0;
  const elapsed = Math.max(0, performance.now() - earliest);

  toolbarProgressTime.textContent = formatDuration(elapsed);
  toolbarProgressBar.style.width = `${(pct * 100).toFixed(1)}%`;
  toolbarProgressPct.textContent = `${(pct * 100).toFixed(1)}%`;
  toolbarProgress.classList.add("live");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} мс`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

// ---------- Слой направляющих ----------

let guidesLayer: HTMLDivElement | null = null;

function ensureGuidesLayer(): HTMLDivElement {
  if (guidesLayer && vizCanvas.contains(guidesLayer)) return guidesLayer;

  guidesLayer = document.createElement("div");
  guidesLayer.className = "viz-guides-layer";
  Object.assign(guidesLayer.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "9999",
    overflow: "visible",
  });

  vizCanvas.appendChild(guidesLayer);
  return guidesLayer;
}

function clearGuides() {
  if (guidesLayer && vizCanvas.contains(guidesLayer)) {
    guidesLayer.replaceChildren();
  }
}

function getCardRect(
  card: VizCard,
): { left: number; top: number; right: number; bottom: number } | null {
  const el = document.getElementById(card.id);
  if (!el) return null;

  const elRect = el.getBoundingClientRect();
  const canvasRect = vizCanvas.getBoundingClientRect();

  return {
    left: elRect.left - canvasRect.left,
    top: elRect.top - canvasRect.top,
    right: elRect.right - canvasRect.left,
    bottom: elRect.bottom - canvasRect.top,
  };
}

function renderGuides(segments: GuideSegment[]) {
  const layer = ensureGuidesLayer();
  layer.replaceChildren();

  const COLOR = "#e63946";
  const TICK = 7;
  const ARROW = 9;

  segments.forEach((seg) => {
    if (seg.kind === "position") {
      const el = document.createElement("div");
      el.className = `viz-guide viz-guide-${seg.orientation} viz-guide-position`;

      if (seg.orientation === "v") {
        el.style.left = `${seg.at}px`;
        el.style.top = `${seg.from}px`;
        el.style.height = `${Math.max(0, seg.to - seg.from)}px`;
      } else {
        el.style.top = `${seg.at}px`;
        el.style.left = `${seg.from}px`;
        el.style.width = `${Math.max(0, seg.to - seg.from)}px`;
      }

      layer.appendChild(el);
      return;
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    Object.assign(svg.style, {
      position: "absolute",
      pointerEvents: "none",
      overflow: "visible",
      display: "block",
    });

    if (seg.orientation === "v") {
      const len = seg.to - seg.from;
      svg.setAttribute("width", "1");
      svg.setAttribute("height", `${len}`);
      svg.style.left = `${seg.at}px`;
      svg.style.top = `${seg.from}px`;

      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "0");
      line.setAttribute("x2", "0");
      line.setAttribute("y2", `${len}`);
      line.setAttribute("stroke", COLOR);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-dasharray", "4 3");
      svg.appendChild(line);

      const ext1 = document.createElementNS(svgNS, "line");
      ext1.setAttribute("x1", `${-TICK}`);
      ext1.setAttribute("y1", "0");
      ext1.setAttribute("x2", `${TICK}`);
      ext1.setAttribute("y2", "0");
      ext1.setAttribute("stroke", COLOR);
      ext1.setAttribute("stroke-width", "1.5");
      svg.appendChild(ext1);

      const ext2 = document.createElementNS(svgNS, "line");
      ext2.setAttribute("x1", `${-TICK}`);
      ext2.setAttribute("y1", `${len}`);
      ext2.setAttribute("x2", `${TICK}`);
      ext2.setAttribute("y2", `${len}`);
      ext2.setAttribute("stroke", COLOR);
      ext2.setAttribute("stroke-width", "1.5");
      svg.appendChild(ext2);

      const arrowTop = document.createElementNS(svgNS, "polygon");
      arrowTop.setAttribute(
        "points",
        `0,0 ${-ARROW / 2},${ARROW} ${ARROW / 2},${ARROW}`,
      );
      arrowTop.setAttribute("fill", COLOR);
      svg.appendChild(arrowTop);

      const arrowBottom = document.createElementNS(svgNS, "polygon");
      arrowBottom.setAttribute(
        "points",
        `0,${len} ${-ARROW / 2},${len - ARROW} ${ARROW / 2},${len - ARROW}`,
      );
      arrowBottom.setAttribute("fill", COLOR);
      svg.appendChild(arrowBottom);
    } else {
      const len = seg.to - seg.from;
      svg.setAttribute("width", `${len}`);
      svg.setAttribute("height", "1");
      svg.style.left = `${seg.from}px`;
      svg.style.top = `${seg.at}px`;

      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "0");
      line.setAttribute("x2", `${len}`);
      line.setAttribute("y2", "0");
      line.setAttribute("stroke", COLOR);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-dasharray", "4 3");
      svg.appendChild(line);

      const ext1 = document.createElementNS(svgNS, "line");
      ext1.setAttribute("x1", "0");
      ext1.setAttribute("y1", `${-TICK}`);
      ext1.setAttribute("x2", "0");
      ext1.setAttribute("y2", `${TICK}`);
      ext1.setAttribute("stroke", COLOR);
      ext1.setAttribute("stroke-width", "1.5");
      svg.appendChild(ext1);

      const ext2 = document.createElementNS(svgNS, "line");
      ext2.setAttribute("x1", `${len}`);
      ext2.setAttribute("y1", `${-TICK}`);
      ext2.setAttribute("x2", `${len}`);
      ext2.setAttribute("y2", `${TICK}`);
      ext2.setAttribute("stroke", COLOR);
      ext2.setAttribute("stroke-width", "1.5");
      svg.appendChild(ext2);

      const arrowLeft = document.createElementNS(svgNS, "polygon");
      arrowLeft.setAttribute(
        "points",
        `0,0 ${ARROW},${-ARROW / 2} ${ARROW},${ARROW / 2}`,
      );
      arrowLeft.setAttribute("fill", COLOR);
      svg.appendChild(arrowLeft);

      const arrowRight = document.createElementNS(svgNS, "polygon");
      arrowRight.setAttribute(
        "points",
        `${len},0 ${len - ARROW},${-ARROW / 2} ${len - ARROW},${ARROW / 2}`,
      );
      arrowRight.setAttribute("fill", COLOR);
      svg.appendChild(arrowRight);
    }

    layer.appendChild(svg);
  });
}

function buildVerticalSegment(
  card: VizCard,
  snap: SnapCandidate,
): GuideSegment[] {
  if (snap.type === "size" && snap.refCard) {
    const cardRect = getCardRect(card);
    const refRect = getCardRect(snap.refCard);
    if (!cardRect || !refRect) return [];

    const OFFSET = 10;

    return [
      {
        orientation: "v",
        at: cardRect.right + OFFSET,
        from: cardRect.top,
        to: cardRect.bottom,
        kind: "size",
      },
      {
        orientation: "v",
        at: refRect.right + OFFSET,
        from: refRect.top,
        to: refRect.bottom,
        kind: "size",
      },
    ];
  }

  if (snap.refCard) {
    const cardRect = getCardRect(card);
    const refRect = getCardRect(snap.refCard);
    if (!cardRect || !refRect) return [];

    const from = Math.min(cardRect.top, refRect.top) - GUIDE_PADDING;
    const to = Math.max(cardRect.bottom, refRect.bottom) + GUIDE_PADDING;

    return [{ orientation: "v", at: snap.guideAt, from, to, kind: "position" }];
  }

  return [
    {
      orientation: "v",
      at: snap.guideAt,
      from: 0,
      to: vizCanvas.clientHeight,
      kind: "position",
    },
  ];
}

function buildHorizontalSegment(
  card: VizCard,
  snap: SnapCandidate,
): GuideSegment[] {
  if (snap.type === "size" && snap.refCard) {
    const cardRect = getCardRect(card);
    const refRect = getCardRect(snap.refCard);
    if (!cardRect || !refRect) return [];

    const OFFSET = 10;

    return [
      {
        orientation: "h",
        at: cardRect.bottom + OFFSET,
        from: cardRect.left,
        to: cardRect.right,
        kind: "size",
      },
      {
        orientation: "h",
        at: refRect.bottom + OFFSET,
        from: refRect.left,
        to: refRect.right,
        kind: "size",
      },
    ];
  }

  if (snap.refCard) {
    const cardRect = getCardRect(card);
    const refRect = getCardRect(snap.refCard);
    if (!cardRect || !refRect) return [];

    const from = Math.min(cardRect.left, refRect.left) - GUIDE_PADDING;
    const to = Math.max(cardRect.right, refRect.right) + GUIDE_PADDING;

    return [{ orientation: "h", at: snap.guideAt, from, to, kind: "position" }];
  }

  return [
    {
      orientation: "h",
      at: snap.guideAt,
      from: 0,
      to: vizCanvas.clientWidth,
      kind: "position",
    },
  ];
}

function findSnapX(
  proposedX: number,
  width: number,
  excludeId: string,
): SnapCandidate | null {
  const boundsW = vizCanvas.clientWidth;
  const candidates: SnapCandidate[] = [
    { value: 0, guideAt: 0, type: "position" },
    { value: boundsW - width, guideAt: boundsW, type: "position" },
    { value: (boundsW - width) / 2, guideAt: boundsW / 2, type: "position" },
  ];

  for (const c of vizCards) {
    if (c.id === excludeId) continue;
    candidates.push({ value: c.x, guideAt: c.x, refCard: c, type: "position" });
    candidates.push({
      value: c.x + c.width - width,
      guideAt: c.x + c.width,
      refCard: c,
      type: "position",
    });
    candidates.push({
      value: c.x + c.width / 2 - width / 2,
      guideAt: c.x + c.width / 2,
      refCard: c,
      type: "position",
    });
    candidates.push({
      value: c.x - width,
      guideAt: c.x,
      refCard: c,
      type: "position",
    });
    candidates.push({
      value: c.x + c.width,
      guideAt: c.x + c.width,
      refCard: c,
      type: "position",
    });
  }

  let best: SnapCandidate | null = null;
  let bestD = SNAP_THRESHOLD + 1;
  for (const cand of candidates) {
    const d = Math.abs(proposedX - cand.value);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return best;
}

function findSnapY(
  proposedY: number,
  height: number,
  excludeId: string,
): SnapCandidate | null {
  const boundsH = vizCanvas.clientHeight;
  const candidates: SnapCandidate[] = [
    { value: 0, guideAt: 0, type: "position" },
    { value: boundsH - height, guideAt: boundsH, type: "position" },
    { value: (boundsH - height) / 2, guideAt: boundsH / 2, type: "position" },
  ];

  for (const c of vizCards) {
    if (c.id === excludeId) continue;
    candidates.push({ value: c.y, guideAt: c.y, refCard: c, type: "position" });
    candidates.push({
      value: c.y + c.height - height,
      guideAt: c.y + c.height,
      refCard: c,
      type: "position",
    });
    candidates.push({
      value: c.y + c.height / 2 - height / 2,
      guideAt: c.y + c.height / 2,
      refCard: c,
      type: "position",
    });
    candidates.push({
      value: c.y - height,
      guideAt: c.y,
      refCard: c,
      type: "position",
    });
    candidates.push({
      value: c.y + c.height,
      guideAt: c.y + c.height,
      refCard: c,
      type: "position",
    });
  }

  let best: SnapCandidate | null = null;
  let bestD = SNAP_THRESHOLD + 1;
  for (const cand of candidates) {
    const d = Math.abs(proposedY - cand.value);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return best;
}

function findBestMatch(
  size: number,
  dim: "width" | "height",
  excludeId: string,
): VizCard | null {
  let best: VizCard | null = null;
  let bestDiff = SNAP_THRESHOLD;
  for (const c of vizCards) {
    if (c.id === excludeId) continue;
    const d = Math.abs(size - c[dim]);
    if (d <= bestDiff) {
      bestDiff = d;
      best = c;
    }
  }
  return best;
}

// ---------- Размеры и размещение ----------

function getDefaultSize(vizId: string): { width: number; height: number } {
  if (vizId === "summary") return { width: 340, height: 260 };
  return { width: 420, height: 320 };
}

function findPlacement(
  width: number,
  height: number,
): { x: number; y: number } {
  const boundsW = vizCanvas.clientWidth;
  const boundsH = vizCanvas.clientHeight;

  if (vizCards.length === 0) {
    return { x: WORKSPACE_PADDING, y: WORKSPACE_PADDING };
  }

  const last = vizCards[vizCards.length - 1];

  const rightX = last.x + last.width + CARD_GAP;
  if (rightX + width + WORKSPACE_PADDING <= boundsW) {
    return { x: rightX, y: last.y };
  }

  const belowY = last.y + last.height + CARD_GAP;
  if (belowY + height + WORKSPACE_PADDING <= boundsH) {
    return { x: WORKSPACE_PADDING, y: belowY };
  }

  return {
    x: WORKSPACE_PADDING + 30,
    y: WORKSPACE_PADDING + 30,
  };
}

function makeDefaultBucket(index: number): Bucket {
  return {
    id: `bucket-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Группа ${index + 1}`,
    operator: "lt",
    value1: null,
    value2: null,
  };
}

function addVizCard(vizId: string): VizCard | null {
  const viz = VIZ_OPTIONS.find((v) => v.id === vizId);
  if (!viz) return null;

  const id = `viz-card-${++cardCounter}`;
  const size = getDefaultSize(vizId);
  const pos = findPlacement(size.width, size.height);

  const isBuckets =
    vizId === "histogram-buckets" ||
    vizId === "barchart-buckets" ||
    vizId === "histogram-grouped" ||
    vizId === "barchart-grouped";

  const card: VizCard = {
    id,
    vizId,
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    settings: {
      title: viz.defaultTitle ?? viz.label,
      showLegend: false,
      showAxisLabels: true,
      legendText: "",
      slots: [null, null],
      bins: 30,
      yLabelOverride:
        vizId === "histogram" ||
        vizId === "barchart" ||
        vizId === "histogram-buckets" ||
        vizId === "barchart-buckets" ||
        vizId === "histogram-grouped" ||
        vizId === "barchart-grouped"
          ? "Частота"
          : "",
      topN: 0,
      showGrid: true,
      precision: 0,
      buckets: isBuckets ? [makeDefaultBucket(0)] : [],
      bucketsShowName: true,
      renderMode: "grouped",
    },
  };

  vizCards.push(card);
  createCardElement(card);
  vizEmptyState.style.display = "none";

  scheduleSaveVizState();

  return card;
}

function createCardElement(card: VizCard, sheetId?: string) {
  const viz = VIZ_OPTIONS.find((v) => v.id === card.vizId);
  if (!viz) return;

  const targetSheetId = sheetId ?? activeSheetId;
  const isLegend = card.vizId === "legend";

  const el = document.createElement("div");
  el.className = isLegend ? "viz-card viz-card-legend" : "viz-card";
  el.id = card.id;
  el.style.left = `${card.x}px`;
  el.style.top = `${card.y}px`;
  el.style.width = `${card.width}px`;
  el.style.height = `${card.height}px`;

  el.innerHTML = `
        <div class="viz-card-header">
            <span class="viz-card-title">${escapeHtml(card.settings.title)}</span>
            <button class="viz-card-close" title="Удалить">×</button>
        </div>
        <div class="viz-card-body ${isLegend ? "legend-card-body" : ""}">
            ${isLegend ? "" : buildVizSVG(card)}
        </div>
        <div class="viz-card-resize" title="Изменить размер"></div>
    `;

  const layer = ensureSheetLayer(targetSheetId);
  layer.appendChild(el);

  const closeBtn = el.querySelector(".viz-card-close") as HTMLButtonElement;
  closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeVizCard(card.id);
  });

  el.addEventListener("pointerdown", () => {
    setActiveCard(card.id);
  });

  el.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(".viz-card-close") ||
      target.closest(".viz-card-resize") ||
      target.closest(".viz-card-issues-badge") ||
      target.closest(".viz-card-legend-badge")
    ) {
      return;
    }
    openSettingsPanel();
  });

  makeDraggable(el, card);
  makeResizable(el, card);

  if (isLegend) {
    renderLegendCardBody(card);
  }

  // Бейдж легенды — только для grouped-визуализаций
  if (card.vizId === "histogram-grouped" || card.vizId === "barchart-grouped") {
    const badge = createLegendBadge(el);
    if (badge) legendBadges.set(card.id, badge);
  }
}

// ---------- Перетаскивание ----------

function makeDraggable(el: HTMLElement, card: VizCard) {
  const header = el.querySelector(".viz-card-header") as HTMLElement;

  header.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".viz-card-close")) return;
    if ((e.target as HTMLElement).closest(".viz-card-issues-badge")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = card.x;
    const origY = card.y;

    el.classList.add("dragging");

    const onMove = (ev: PointerEvent) => {
      const boundsW = vizCanvas.clientWidth;
      const boundsH = vizCanvas.clientHeight;

      let newX = origX + (ev.clientX - startX);
      let newY = origY + (ev.clientY - startY);

      newX = Math.max(0, Math.min(newX, boundsW - card.width));
      newY = Math.max(0, Math.min(newY, boundsH - card.height));

      const snapX = findSnapX(newX, card.width, card.id);
      const snapY = findSnapY(newY, card.height, card.id);

      if (snapX) newX = snapX.value;
      if (snapY) newY = snapY.value;

      newX = Math.max(0, Math.min(newX, boundsW - card.width));
      newY = Math.max(0, Math.min(newY, boundsH - card.height));

      card.x = newX;
      card.y = newY;
      el.style.left = `${newX}px`;
      el.style.top = `${newY}px`;

      const segments: GuideSegment[] = [];
      if (snapX) segments.push(...buildVerticalSegment(card, snapX));
      if (snapY) segments.push(...buildHorizontalSegment(card, snapY));
      renderGuides(segments);
    };

    const onStop = () => {
      el.classList.remove("dragging");
      clearGuides();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onStop);
      document.removeEventListener("pointercancel", onStop);
      scheduleSaveVizState();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onStop);
    document.addEventListener("pointercancel", onStop);
  });
}

// ---------- Ресайз ----------

function makeResizable(el: HTMLElement, card: VizCard) {
  const handle = el.querySelector(".viz-card-resize") as HTMLElement;
  if (!handle) return;

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startWidth = card.width;
    const startHeight = card.height;

    el.classList.add("resizing");

    const onMove = (ev: PointerEvent) => {
      const boundsW = vizCanvas.clientWidth;
      const boundsH = vizCanvas.clientHeight;

      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;

      let rawW = startWidth + dx;
      let rawH = startHeight + dy;

      rawW = Math.max(MIN_CARD_WIDTH, Math.min(rawW, boundsW - card.x));
      rawH = Math.max(MIN_CARD_HEIGHT, Math.min(rawH, boundsH - card.y));

      clearGuides();

      const matchW = findBestMatch(rawW, "width", card.id);
      const matchH = findBestMatch(rawH, "height", card.id);

      const finalW = matchW ? matchW.width : rawW;
      const finalH = matchH ? matchH.height : rawH;

      card.width = finalW;
      card.height = finalH;
      el.style.width = `${finalW}px`;
      el.style.height = `${finalH}px`;

      if (!matchW && !matchH) return;

      const segments: GuideSegment[] = [];
      const OFFSET = 10;

      if (matchW) {
        segments.push({
          orientation: "h",
          at: card.y + card.height + OFFSET,
          from: card.x,
          to: card.x + card.width,
          kind: "size",
        });
        segments.push({
          orientation: "h",
          at: matchW.y + matchW.height + OFFSET,
          from: matchW.x,
          to: matchW.x + matchW.width,
          kind: "size",
        });
      }

      if (matchH) {
        segments.push({
          orientation: "v",
          at: card.x + card.width + OFFSET,
          from: card.y,
          to: card.y + card.height,
          kind: "size",
        });
        segments.push({
          orientation: "v",
          at: matchH.x + matchH.width + OFFSET,
          from: matchH.y,
          to: matchH.y + matchH.height,
          kind: "size",
        });
      }

      renderGuides(segments);
    };

    const onStop = () => {
      el.classList.remove("resizing");
      clearGuides();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onStop);
      document.removeEventListener("pointercancel", onStop);
      scheduleSaveVizState();
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onStop);
    document.addEventListener("pointercancel", onStop);
  });
}

// ---------- Удаление и активация ----------

function removeVizCard(cardId: string) {
  // Если это диаграмма — сначала удаляем связанные с ней карточки-легенды
  const linkedLegendIds = vizCards
    .filter((c) => c.vizId === "legend" && c.linkedCardId === cardId)
    .map((c) => c.id);
  for (const id of linkedLegendIds) removeVizCard(id);
    for (const id of [...runningBoxPlots.keys()]) stopBoxPlotForCard(id);

  stopHistogramForCard(cardId);
  stopBarChartForCard(cardId);
  stopBucketedHistogramForCard(cardId);
  stopBucketedBarChartForCard(cardId);
  stopGroupedHistogramForCard(cardId);
  stopGroupedBarChartForCard(cardId);
    stopBoxPlotForCard(cardId);

  const idx = vizCards.findIndex((c) => c.id === cardId);
  if (idx >= 0) vizCards.splice(idx, 1);
  legendBadges.delete(cardId);
  const el = document.getElementById(cardId);
  if (el) el.remove();

  if (activeCardId === cardId) {
    activeCardId = null;
    updateColumnsAvailability();
    if (settingsPanel.classList.contains("open")) closeSettingsPanel();
  }

  if (vizCards.length === 0) {
    vizEmptyState.style.display = "";
  }
  scheduleSaveVizState();
}

function setActiveCard(cardId: string | null) {
  activeCardId = cardId;

  vizCanvas.querySelectorAll(".viz-card").forEach((el) => {
    el.classList.toggle("active", el.id === cardId);
  });

  updateColumnsAvailability();

  if (settingsPanel.classList.contains("open")) {
    if (cardId) {
      renderSettingsContent(cardId);
    } else {
      closeSettingsPanel();
    }
  }

  // Индикатор прогресса зависит от активной карточки — пересчитываем
  updateProgressUI();
  scheduleSaveVizState();
}

// Клик по пустому месту рабочего поля — снять выделение.
// Это переключает индикатор в тулбаре в режим «суммарный».
vizCanvas.addEventListener("pointerdown", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest(".viz-card")) return;
  if (target.closest(".viz-guides-layer")) return;

  if (activeCardId !== null) {
    setActiveCard(null);
  }
});

// ---------- Панель иконок ----------

function renderVizOptions() {
  const histogramList = document.getElementById(
    "viz-options-histogram",
  ) as HTMLUListElement;
  const barchartList = document.getElementById(
    "viz-options-barchart",
  ) as HTMLUListElement;
  const otherList = document.getElementById(
    "viz-options-other",
  ) as HTMLUListElement;

  const listsBySection: Record<string, HTMLUListElement> = {
    histogram: histogramList,
    barchart: barchartList,
    other: otherList,
  };

  const renderItem = (opt: VizOption) => `
    <li
      class="viz-option${opt.enabled ? "" : " disabled"}"
      data-option-id="${opt.id}"
      data-option-label="${opt.label}"
      title="${opt.label}${opt.enabled ? "" : " — в разработке"}"
    >
      ${opt.icon}
    </li>
  `;

  for (const key of Object.keys(listsBySection)) {
    const list = listsBySection[key];
    if (!list) continue;
    const items = VIZ_OPTIONS.filter(
      (o) => o.section === key && o.id !== "legend",
    );
    list.innerHTML = items.map(renderItem).join("");

    list.querySelectorAll<HTMLLIElement>("li").forEach((li) => {
      li.addEventListener("click", () => {
        const id = li.getAttribute("data-option-id");
        if (!id) return;
        const opt = VIZ_OPTIONS.find((o) => o.id === id);
        if (!opt) return;
        if (!opt.enabled) {
          // Заглушка — показываем всплывающую подсказку «в разработке»
          infoTooltip.textContent = `«${opt.label}» — в разработке`;
          infoTooltip.classList.remove("hidden");

          const rect = li.getBoundingClientRect();
          const tipRect = infoTooltip.getBoundingClientRect();
          let left = rect.right + 10;
          let top = rect.top + rect.height / 2 - tipRect.height / 2;

          if (left + tipRect.width > window.innerWidth - 8) {
            left = rect.left - tipRect.width - 10;
          }
          if (top < 8) top = 8;
          if (top + tipRect.height > window.innerHeight - 8) {
            top = window.innerHeight - tipRect.height - 8;
          }

          infoTooltip.style.left = `${left}px`;
          infoTooltip.style.top = `${top}px`;
          window.setTimeout(hideInfoTooltip, 1800);
          return;
        }
        selectVisualization(id);
      });
    });
  }
}

function selectVisualization(vizId: string) {
  const viz = VIZ_OPTIONS.find((v) => v.id === vizId);
  if (!viz) return;

  addVizCard(vizId);
}

// ============================================================
// ЛИСТЫ РАБОЧЕГО ПРОСТРАНСТВА — УПРАВЛЕНИЕ
// ============================================================
// (getCurrentSheet объявлена выше — здесь её нет.)

function renderSheetTabs(): void {
  const scroll = document.getElementById("sheet-tabs-scroll");
  if (!scroll) return;

  scroll.innerHTML = sheets
    .map(
      (sheet) => `
      <div class="sheet-tab${sheet.id === activeSheetId ? " active" : ""}"
           data-sheet-id="${escapeHtml(sheet.id)}"
           title="${escapeHtml(sheet.name)}">
        <span class="sheet-tab-name">${escapeHtml(sheet.name)}</span>
        ${
          sheets.length > 1
            ? `<button class="sheet-tab-close" data-close-sheet="${escapeHtml(sheet.id)}" title="Удалить лист">×</button>`
            : ""
        }
      </div>
    `,
    )
    .join("");

  scroll.querySelectorAll<HTMLElement>(".sheet-tab").forEach((tab) => {
    const sheetId = tab.getAttribute("data-sheet-id");
    if (!sheetId) return;

    tab.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".sheet-tab-close")) return;
      switchSheet(sheetId);
    });

    tab.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest(".sheet-tab-close")) return;
      startRenameSheet(sheetId);
    });
  });

  scroll
    .querySelectorAll<HTMLButtonElement>(".sheet-tab-close")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const sheetId = btn.getAttribute("data-close-sheet");
        if (sheetId) deleteSheet(sheetId);
      });
    });
}

function switchSheet(newSheetId: string): void {
  if (newSheetId === activeSheetId) return;

  const newSheet = sheets.find((s) => s.id === newSheetId);
  if (!newSheet) return;

  // Сохраняем активную карточку текущего листа
  const oldSheet = sheets.find((s) => s.id === activeSheetId);
  if (oldSheet) oldSheet.activeCardId = activeCardId;

  // Переключаем состояние
  activeSheetId = newSheetId;
  // ⚠️ Переприсваиваем ссылку — mutations в vizCards теперь
  // изменяют newSheet.cards (тот же объект массива)
  vizCards = newSheet.cards;
  activeCardId = newSheet.activeCardId;

  // DOM: показываем слой нового листа
  ensureSheetLayer(newSheetId);
  showSheetLayer(newSheetId);

  // Empty state
  vizEmptyState.style.display = vizCards.length === 0 ? "" : "none";

  // Активная карточка
  vizCanvas.querySelectorAll(".viz-card").forEach((el) => {
    el.classList.toggle("active", el.id === activeCardId);
  });

  // Панель настроек
  if (activeCardId) {
    renderSettingsContent(activeCardId);
    settingsPanel.classList.add("open");
  } else {
    closeSettingsPanel();
  }

  updateColumnsAvailability();
  updateProgressUI();
  renderSheetTabs();

  // Скроллим вкладку в видимую зону
  requestAnimationFrame(() => {
    const tab = document.querySelector<HTMLElement>(
      `.sheet-tab[data-sheet-id="${newSheetId}"]`,
    );
    if (tab) {
      tab.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  });

  scheduleSaveVizState();
}

function createSheet(): Sheet {
  // id — технический, для внутреннего map'а слоёв и persistence.
  // Он должен быть всегда уникален, даже после удаления листов,
  // поэтому используем монотонный счётчик.
  const id = `sheet-${++sheetCounter}`;

  // Имя — видимое, генерируется как «первое свободное Лист N».
  // Если пользователь удалил Лист 2 из Лист 1 / Лист 2 / Лист 3,
  // следующий созданный лист снова станет Листом 2, а не Листом 4.
  const usedNumbers = new Set<number>();
  for (const s of sheets) {
    const m = s.name.match(/^Лист\s+(\d+)$/);
    if (m) usedNumbers.add(Number(m[1]));
  }
  let visibleNum = 1;
  while (usedNumbers.has(visibleNum)) visibleNum++;

  const sheet: Sheet = {
    id,
    name: `Лист ${visibleNum}`,
    cards: [],
    activeCardId: null,
  };
  sheets.push(sheet);
  ensureSheetLayer(id);
  switchSheet(id);

  // Автоматически отматываем панель в правый край — новый лист виден
  requestAnimationFrame(() => {
    const scroll = document.getElementById("sheet-tabs-scroll");
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
  });

  return sheet;
}

function startRenameSheet(sheetId: string): void {
  const sheet = sheets.find((s) => s.id === sheetId);
  if (!sheet) return;

  const tab = document.querySelector<HTMLElement>(
    `.sheet-tab[data-sheet-id="${sheetId}"]`,
  );
  if (!tab) return;

  const nameEl = tab.querySelector(".sheet-tab-name");
  if (!nameEl) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "sheet-tab-input";
  input.value = sheet.name;

  tab.replaceChild(input, nameEl);
  input.focus();
  input.select();

  let committed = false;

  const commit = () => {
    if (committed) return;
    committed = true;
    const trimmed = input.value.trim();
    if (trimmed) {
      sheet.name = trimmed;
      scheduleSaveVizState();
    }
    renderSheetTabs();
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    renderSheetTabs();
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
}

function deleteSheet(sheetId: string): void {
  if (sheets.length <= 1) return;

  const sheet = sheets.find((s) => s.id === sheetId);
  if (!sheet) return;

  // Останавливаем все runs на этом листе
  for (const card of sheet.cards) {
    stopBoxPlotForCard(card.id);
    stopHistogramForCard(card.id);
    stopBarChartForCard(card.id);
    stopBucketedHistogramForCard(card.id);
    stopBucketedBarChartForCard(card.id);
    stopGroupedHistogramForCard(card.id);
    stopGroupedBarChartForCard(card.id);
    legendBadges.delete(card.id);
  }

  // Удаляем слой
  const layer = sheetLayers.get(sheetId);
  if (layer) layer.remove();
  sheetLayers.delete(sheetId);

  // Удаляем из массива
  const idx = sheets.findIndex((s) => s.id === sheetId);
  sheets.splice(idx, 1);

  // Если удалили активный — переключаемся на соседний
  if (activeSheetId === sheetId) {
    const target = sheets[Math.min(idx, sheets.length - 1)];
    activeSheetId = ""; // force switch
    switchSheet(target.id);
  } else {
    renderSheetTabs();
  }

  scheduleSaveVizState();
}

// Обработчик кнопки «+»
document.getElementById("sheet-tabs-add")?.addEventListener("click", () => {
  createSheet();
});

function resetVizOptions() {
  // Останавливаем все runs
  for (const sheet of sheets) {
    for (const card of sheet.cards) {
      stopHistogramForCard(card.id);
      stopBarChartForCard(card.id);
      stopBucketedHistogramForCard(card.id);
      stopBucketedBarChartForCard(card.id);
      stopGroupedHistogramForCard(card.id);
      stopGroupedBarChartForCard(card.id);
            stopBoxPlotForCard(card.id);
    }
  }

  // Очищаем листы
  for (const layer of sheetLayers.values()) layer.remove();
  sheetLayers.clear();
  sheets = [];
  sheetCounter = 0;
  vizCards = [];
  activeSheetId = "";
  activeCardId = null;
  selectedColumnIndex = null;
  legendBadges.clear();

  vizCanvas.querySelectorAll(".viz-card").forEach((el) => el.remove());
  clearGuides();
  vizEmptyState.style.display = "";

  if (settingsPanel.classList.contains("open")) closeSettingsPanel();

  resetProgress();

  // Создаём первый пустой лист
  createSheet();

  renderVizOptions();
  updateColumnsAvailability();
  renderSheetTabs();
}

// ============================================================
// ПАНЕЛЬ НАСТРОЕК КАРТОЧКИ
// ============================================================

settingsCloseBtn.addEventListener("click", () => closeSettingsPanel());
settingsContent.addEventListener("scroll", hideInfoTooltip, { passive: true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsPanel.classList.contains("open")) {
    closeSettingsPanel();
  }
});

function openSettingsPanel() {
  if (!activeCardId) return;
  settingsPanel.classList.add("open");
  renderSettingsContent(activeCardId);

  requestAnimationFrame(() => {
    const rect = settingsPanel.getBoundingClientRect();
    // Если панель целиком влезает — не скроллим
    if (rect.right > window.innerWidth + 1) {
      settingsPanel.scrollIntoView({
        behavior: "smooth",
        inline: "end",
        block: "nearest",
      });
    }
  });
}

function closeSettingsPanel() {
  settingsPanel.classList.remove("open");
}

const BUCKET_OPERATOR_OPTIONS: { value: BucketOperator; label: string }[] = [
  { value: "lt", label: "Меньше" },
  { value: "lte", label: "Меньше или равно" },
  { value: "gt", label: "Больше" },
  { value: "gte", label: "Больше или равно" },
  { value: "eq", label: "Равно" },
  { value: "neq", label: "Не равно" },
  { value: "range", label: "Диапазон (от–до)" },
  { value: "other", label: "Другое (все не попавшие)" },
];

function bucketOperatorSymbol(op: BucketOperator): string {
  switch (op) {
    case "lt":
      return "<";
    case "lte":
      return "≤";
    case "gt":
      return ">";
    case "gte":
      return "≥";
    case "eq":
      return "=";
    case "neq":
      return "≠";
    case "range":
      return "↔";
    case "other":
      return "…";
  }
}

function matchesBucket(value: number, b: Bucket): boolean {
  const v1 = b.value1;
  const v2 = b.value2;
  switch (b.operator) {
    case "lt":
      return v1 != null && value < v1;
    case "lte":
      return v1 != null && value <= v1;
    case "gt":
      return v1 != null && value > v1;
    case "gte":
      return v1 != null && value >= v1;
    case "eq":
      return v1 != null && value === v1;
    case "neq":
      return v1 != null && value !== v1;
    case "range":
      return v1 != null && v2 != null && value >= v1 && value <= v2;
    case "other":
      // "other" ловит всё, что не попало в остальные бакеты.
      // Здесь всегда false — реальный подсчёт делается отдельно.
      return false;
  }
}

function formatBucketCondition(b: Bucket): string {
  if (b.operator === "other") return "другое";
  const v1 = b.value1 != null ? b.value1 : "—";
  const v2 = b.value2 != null ? b.value2 : "—";
  if (b.operator === "range") {
    return `${v1}–${v2}`;
  }
  return `${bucketOperatorSymbol(b.operator)} ${v1}`;
}

function renderBucketCard(b: Bucket, index: number, total: number): string {
  const canRemove = total > 1;
  const isRange = b.operator === "range";
  const isOther = b.operator === "other";

  const opSelectHtml = `
    <select class="settings-select bucket-op" data-bucket-op>
      ${BUCKET_OPERATOR_OPTIONS.map(
        (opt) =>
          `<option value="${opt.value}" ${opt.value === b.operator ? "selected" : ""}>${opt.label}</option>`,
      ).join("")}
    </select>
  `;

  let conditionHtml: string;
  if (isOther) {
    conditionHtml = `
      <div class="bucket-condition other">
        ${opSelectHtml}
        <p class="bucket-other-hint">
          Соберёт все значения, не попавшие ни в одну из остальных групп.
        </p>
      </div>
    `;
  } else if (isRange) {
    conditionHtml = `
      <div class="bucket-condition range">
        ${opSelectHtml}
        <div class="bucket-range-row">
          <input type="number" class="settings-input bucket-v1"
                 data-bucket-v1
                 value="${b.value1 ?? ""}"
                 placeholder="от"
                 step="any" />
          <input type="number" class="settings-input bucket-v2"
                 data-bucket-v2
                 value="${b.value2 ?? ""}"
                 placeholder="до"
                 step="any" />
        </div>
      </div>
    `;
  } else {
    conditionHtml = `
      <div class="bucket-condition">
        ${opSelectHtml}
        <input type="number" class="settings-input bucket-v1"
               data-bucket-v1
               value="${b.value1 ?? ""}"
               placeholder="знач."
               step="any" />
      </div>
    `;
  }

  return `
    <div class="bucket-card${isOther ? " bucket-card-other" : ""}" data-bucket-id="${escapeHtml(b.id)}">
      <div class="bucket-card-header">
        <span class="bucket-card-num">${index + 1}</span>
        <button
          class="bucket-card-remove"
          data-remove-bucket
          title="${canRemove ? "Удалить группу" : "Нельзя удалить единственную группу"}"
          ${canRemove ? "" : "disabled"}
        >×</button>
      </div>

      <div class="settings-field">
        <label class="settings-label">Название</label>
        <input type="text" class="settings-input"
               data-bucket-name
               value="${escapeHtml(b.name)}"
               placeholder="Empty" />
      </div>

      <div class="settings-field">
        <label class="settings-label">Условие</label>
        ${conditionHtml}
      </div>
    </div>
  `;
}

function renderSettingsContent(cardId: string) {
  const card = vizCards.find((c) => c.id === cardId);
  if (!card) {
    closeSettingsPanel();
    return;
  }

  // Легенда не имеет настроек — закрываем панель.
  if (card.vizId === "legend") {
    closeSettingsPanel();
    return;
  }

  const viz = VIZ_OPTIONS.find((v) => v.id === card.vizId);
  if (!viz) {
    closeSettingsPanel();
    return;
  }

  settingsPanelTitle.textContent = `Настройки · ${viz.label}`;

  const s = card.settings;
  const [slot0, slot1] = s.slots;
  const isHistogram = card.vizId === "histogram";
  const isHistogramBuckets = card.vizId === "histogram-buckets";
  const isHistogramGrouped = card.vizId === "histogram-grouped";
  const isBarChart = card.vizId === "barchart";
  const isBarChartBuckets = card.vizId === "barchart-buckets";
  const isBarChartGrouped = card.vizId === "barchart-grouped";
  const isBuckets = isHistogramBuckets || isBarChartBuckets;
  const hasBuckets = isBuckets || isHistogramGrouped || isBarChartGrouped;
  /** Любая grouped/stacked-визуализация (гисто или линейчатая). */
  const isGrouped = isHistogramGrouped || isBarChartGrouped;

  // ---------- Легенда ----------
  let legendFieldsHtml = "";
  if (isGrouped) {
    // В grouped-визуализациях легенда строится по категориям
    // группировки (seriesNames), а не по вводимому тексту.
    // Показываем подсказку, а не поле ввода — иначе пользователь
    // вводит текст и не понимает, почему он не появляется.
    legendFieldsHtml = `
      <p class="settings-hint">
        Легенда строится автоматически по категориям колонки «Группировка».
        ${slot1 ? `Сейчас серии — значения из <b>${escapeHtml(slot1.name)}</b>.` : ""}
      </p>`;
  } else if (slot0) {
    legendFieldsHtml = `
      <div class="settings-field">
        <label class="settings-label">Текст легенды</label>
        <input type="text" class="settings-input"
               data-legend-text
               value="${escapeHtml(s.legendText)}"
               placeholder="${escapeHtml(slot0.name)}"
               ${s.showLegend ? "" : "disabled"} />
      </div>`;
  } else {
    legendFieldsHtml = `<p class="settings-hint">Перетащите колонку в «Данные» — легенда появится здесь.</p>`;
  }

  // ---------- Подписи на осях ----------
  let axisFieldsHtml = "";
  if (slot0) {
    if (isHistogram || isHistogramBuckets || isHistogramGrouped) {
      axisFieldsHtml = `
        <div class="settings-field">
          <label class="settings-label">Подпись оси X (значения)</label>
          <input type="text" class="settings-input"
                 data-axis-x
                 value="${escapeHtml(slot0.legendText)}"
                 placeholder="${escapeHtml(slot0.name)}"
                 ${s.showAxisLabels ? "" : "disabled"} />
        </div>
        <div class="settings-field">
          <label class="settings-label">Подпись оси Y (частота)</label>
          <input type="text" class="settings-input"
                 data-axis-y
                 value="${escapeHtml(s.yLabelOverride)}"
                 placeholder="Частота"
                 ${s.showAxisLabels ? "" : "disabled"} />
        </div>`;
    } else {
      axisFieldsHtml = `
        <div class="settings-field">
          <label class="settings-label">Подпись оси X (частота)</label>
          <input type="text" class="settings-input"
                 data-axis-y
                 value="${escapeHtml(s.yLabelOverride)}"
                 placeholder="Частота"
                 ${s.showAxisLabels ? "" : "disabled"} />
        </div>
        <div class="settings-field">
          <label class="settings-label">Подпись оси Y (значения)</label>
          <input type="text" class="settings-input"
                 data-axis-x
                 value="${escapeHtml(slot0.legendText)}"
                 placeholder="${escapeHtml(slot0.name)}"
                 ${s.showAxisLabels ? "" : "disabled"} />
        </div>`;
    }
  } else {
    axisFieldsHtml = `<p class="settings-hint">Перетащите колонку в «Данные» — подписи появятся здесь.</p>`;
  }

  // ---------- Данные ----------
  let dataSlotsHtml = "";
  if (isGrouped) {
    dataSlotsHtml = `
        <div class="settings-slot">
          <label class="settings-label">Значения (числовая колонка)</label>
          <div class="settings-dropzone"
               data-dropzone="0"
               data-expected-type="numeric">
            ${renderSlotContent(slot0, 0)}
          </div>
        </div>
        <div class="settings-slot">
          <label class="settings-label">Группировка (категориальная колонка)</label>
          <div class="settings-dropzone"
               data-dropzone="1"
               data-expected-type="categorical">
            ${renderSlotContent(slot1, 1)}
          </div>
        </div>
        <p class="settings-hint">Ось Y — частота. Цвета соответствуют категориям.</p>
      `;
  } else if (
    isHistogram ||
    isHistogramBuckets ||
    isBarChart ||
    isBarChartBuckets ||
    card.vizId === "boxplot" ||
    card.vizId === "summary"
  ) {
    dataSlotsHtml = `
        <div class="settings-slot">
          <label class="settings-label">Значения (числовая колонка)</label>
          <div class="settings-dropzone"
               data-dropzone="0"
               data-expected-type="numeric">
            ${renderSlotContent(slot0, 0)}
          </div>
        </div>
        <p class="settings-hint">Ось Y (частота) рассчитывается автоматически.</p>
      `;
  } else if (card.vizId === "piechart") {
    dataSlotsHtml = `
        <div class="settings-slot">
          <label class="settings-label">Категории (категориальная колонка)</label>
          <div class="settings-dropzone"
               data-dropzone="0"
               data-expected-type="categorical">
            ${renderSlotContent(slot0, 0)}
          </div>
        </div>
        <p class="settings-hint">Показывается доля каждой уникальной категории.</p>
      `;
  } else {
    dataSlotsHtml = `
        <div class="settings-slot">
          <label class="settings-label">Значения</label>
          <div class="settings-dropzone" data-dropzone="0">
            ${renderSlotContent(slot0, 0)}
          </div>
        </div>
        <p class="settings-hint">Показывается количество записей для каждого уникального значения.</p>
      `;
  }

  // ---------- Диапазоны данных ----------
  let bucketsHtml = "";
  if (hasBuckets) {
    bucketsHtml = `
      <div class="settings-block">
        <div class="buckets-header">
          <h5 class="settings-block-title">
            Диапазоны данных — <b>${s.buckets.length}</b><span
              class="info-icon"
data-tooltip="Крайние значения диапазона входят в группу.
Если условия групп пересекаются, значение попадёт в ту группу, которая расположена выше в списке.">?</span
            >
          </h5>
          <button class="buckets-add-btn" data-add-bucket title="Добавить группу">+</button>
        </div>
        <div class="buckets-list">
          ${s.buckets.map((b, i) => renderBucketCard(b, i, s.buckets.length)).join("")}
        </div>
        <label class="settings-checkbox">
          <input type="checkbox" data-buckets-show-name ${s.bucketsShowName ? "checked" : ""} />
          <span>Показывать на оси название группы</span>
        </label>
      </div>`;
  }

  // ---------- Параметры ----------
  let paramsHtml = "";
  if (isGrouped) {
    paramsHtml = `
      <div class="settings-block">
        <h5 class="settings-block-title">Параметры</h5>
        <div class="settings-field">
          <label class="settings-label">Режим отрисовки</label>
          <select class="settings-select" data-setting="renderMode">
            <option value="grouped" ${s.renderMode === "grouped" ? "selected" : ""}>Рядом (Grouped)</option>
            <option value="stacked" ${s.renderMode === "stacked" ? "selected" : ""}>Стопкой (Stacked)</option>
          </select>
        </div>
        <div class="settings-field">
          <label class="settings-label">Топ-N категорий (0 = все)</label>
          <input type="number" class="settings-input" min="0" max="50" data-setting="topN" value="${s.topN}" />
        </div>
        <div class="settings-field">
          <div class="settings-label-row">
            <span class="settings-label">
              Точность<span
                class="info-icon"
                data-tooltip="Количество знаков после запятой в подписях осей. 0 – округление до целых чисел."
                >?</span
              >
            </span>
            <span class="settings-value" data-precision-value>${s.precision}</span>
          </div>
          <input type="range" class="settings-range"
                 data-setting="precision"
                 min="0" max="5" step="1"
                 value="${s.precision}" />
        </div>
        <label class="settings-checkbox">
          <input type="checkbox" data-setting="showGrid" ${s.showGrid ? "checked" : ""} />
          <span>Показывать сетку</span>
        </label>
      </div>`;
  } else if (isHistogram || isBarChart) {
    paramsHtml = `
      <div class="settings-block">
        <h5 class="settings-block-title">Параметры</h5>
        <div class="settings-field">
          <div class="settings-label-row">
            <span class="settings-label">
              Количество бинов<span
                class="info-icon"
                data-tooltip="Бины – интервалы, на которые делится диапазон значений. Больше бинов – детальнее гистограмма, но заметнее шум. Для распределений с длинным хвостом (выручка, цены) попробуйте 80–150 бинов или «С диапазонами»."
                >?</span
              >
            </span>
            <input type="number" class="settings-number-inline"
                   data-bins-number
                   min="5" max="200" step="1"
                   value="${s.bins}" />
          </div>
          <input type="range" class="settings-range"
                 data-bins-range
                 min="5" max="200" step="1"
                 value="${s.bins}" />
        </div>
        <div class="settings-field">
          <label class="settings-label">Топ-N бинов (0 = все)</label>
          <input type="number" class="settings-input" min="0" max="1000"
                 data-setting="topN" value="${s.topN}" />
        </div>
        <div class="settings-field">
          <div class="settings-label-row">
            <span class="settings-label">
              Точность<span
                class="info-icon"
                data-tooltip="Количество знаков после запятой в подписях осей. 0 – округление до целых чисел."
                >?</span
              >
            </span>
            <input type="number" class="settings-number-inline"
                   data-precision-number
                   min="0" max="5" step="1"
                   value="${s.precision}" />
          </div>
          <input type="range" class="settings-range"
                 data-precision-range
                 min="0" max="5" step="1"
                 value="${s.precision}" />
        </div>
        <label class="settings-checkbox">
          <input type="checkbox" data-setting="showGrid" ${s.showGrid ? "checked" : ""} />
          <span>Показывать сетку</span>
        </label>
      </div>`;
  } else if (hasBuckets) {
    paramsHtml = `
      <div class="settings-block">
        <h5 class="settings-block-title">Параметры</h5>
        <div class="settings-field">
          <div class="settings-label-row">
            <span class="settings-label">
              Точность<span
                class="info-icon"
                data-tooltip="Количество знаков после запятой в подписях осей. 0 – округление до целых чисел."
                >?</span
              >
            </span>
            <span class="settings-value" data-precision-value>${s.precision}</span>
          </div>
          <input type="range" class="settings-range"
                 data-setting="precision"
                 min="0" max="5" step="1"
                 value="${s.precision}" />
        </div>
        <label class="settings-checkbox">
          <input type="checkbox" data-setting="showGrid" ${s.showGrid ? "checked" : ""} />
          <span>Показывать сетку</span>
        </label>
      </div>`;
  }

  settingsContent.innerHTML = `
    <div class="settings-block">
      <h5 class="settings-block-title">Заголовок</h5>
      <input type="text" class="settings-input" data-setting="title"
             value="${escapeHtml(s.title)}"
             placeholder="Название диаграммы" />
    </div>

    <div class="settings-block">
      <h5 class="settings-block-title">Легенда</h5>
      <label class="settings-checkbox">
        <input type="checkbox" data-setting="showLegend" ${s.showLegend ? "checked" : ""} />
        <span>Вывести легенду на диаграмму</span>
      </label>
      ${legendFieldsHtml}
    </div>

    ${bucketsHtml}

    ${paramsHtml}

    <div class="settings-block">
      <h5 class="settings-block-title">Подписи на осях</h5>
      <label class="settings-checkbox">
        <input type="checkbox" data-setting="showAxisLabels" ${s.showAxisLabels ? "checked" : ""} />
        <span>Показывать подписи на осях</span>
      </label>
      ${axisFieldsHtml}
    </div>

    <div class="settings-block">
      <h5 class="settings-block-title">Данные</h5>
      ${dataSlotsHtml}
    </div>
  `;

  // ---------- Заголовок ----------
  const titleInput = settingsContent.querySelector(
    '[data-setting="title"]',
  ) as HTMLInputElement;
  titleInput.addEventListener("input", () => {
    s.title = titleInput.value;
    updateCardTitle(card);
    scheduleSaveVizState();
  });

  // ---------- Легенда: чекбокс ----------
  const legendCheck = settingsContent.querySelector(
    '[data-setting="showLegend"]',
  ) as HTMLInputElement;
  legendCheck.addEventListener("change", () => {
    s.showLegend = legendCheck.checked;

    // Обновляем бейдж сразу — иначе он появится только при следующем
    // пересчёте (onProgress), а при уже посчитанной диаграмме это
    // может быть надолго.
    if (isGrouped) {
      const activeCount = vizCards.find((c) => c.id === cardId)?.settings
        ? (runningGroupedHistograms.get(cardId)?.getSeriesNames().length ??
          runningGroupedBars.get(cardId)?.getSeriesNames().length ??
          0)
        : 0;
      if (legendCheck.checked) {
        legendBadges.get(cardId)?.update(activeCount);
      } else {
        // Скрываем бейдж, если галочку убрали
        legendBadges.get(cardId)?.update(0);
      }
    }

    renderSettingsContent(cardId);
    redrawActive(card);
    scheduleSaveVizState();
  });

  // ---------- Легенда: текст ----------
  const legendTextInput = settingsContent.querySelector(
    "[data-legend-text]",
  ) as HTMLInputElement | null;
  if (legendTextInput) {
    legendTextInput.addEventListener("input", () => {
      s.legendText = legendTextInput.value;
      redrawActive(card);
      scheduleSaveVizState();
    });
  }

  // ---------- Подписи на осях ----------
  const axisCheck = settingsContent.querySelector(
    '[data-setting="showAxisLabels"]',
  ) as HTMLInputElement | null;
  if (axisCheck) {
    axisCheck.addEventListener("change", () => {
      s.showAxisLabels = axisCheck.checked;
      renderSettingsContent(cardId);
      redrawActive(card);
      scheduleSaveVizState();
    });
  }

  // ---------- Подпись оси X ----------
  const axisXInput = settingsContent.querySelector(
    "[data-axis-x]",
  ) as HTMLInputElement | null;
  if (axisXInput) {
    axisXInput.addEventListener("input", () => {
      const slot = s.slots[0];
      if (!slot) return;
      slot.legendText = axisXInput.value;
      redrawActive(card);
      scheduleSaveVizState();
    });
  }

  // ---------- Подпись оси Y ----------
  const axisYInput = settingsContent.querySelector(
    "[data-axis-y]",
  ) as HTMLInputElement | null;
  if (axisYInput) {
    axisYInput.addEventListener("input", () => {
      s.yLabelOverride = axisYInput.value;
      redrawActive(card);
      scheduleSaveVizState();
    });
  }

  // ---------- Бины (slider + number) ----------
  //
  // Диапазон 5..200. Пока пользователь печатает, не клэмпим —
  // иначе нельзя набрать «150» (после «1» поле бы обрезалось до 5).
  // Клэмпинг происходит на blur/Enter.
  const BINS_MIN = 5;
  const BINS_MAX = 200;

  const binsRange =
    settingsContent.querySelector<HTMLInputElement>("[data-bins-range]");
  const binsNumber =
    settingsContent.querySelector<HTMLInputElement>("[data-bins-number]");

  const clampBins = (n: number): number => {
    if (!Number.isFinite(n)) return s.bins;
    return Math.max(BINS_MIN, Math.min(BINS_MAX, Math.round(n)));
  };
  const syncBinsInputs = (n: number) => {
    if (binsRange) binsRange.value = String(n);
    if (binsNumber) binsNumber.value = String(n);
  };

  if (binsRange) {
    binsRange.addEventListener("input", () => {
      const n = clampBins(Number(binsRange.value));
      s.bins = n;
      if (binsNumber) binsNumber.value = String(n);
    });
    binsRange.addEventListener("change", () => {
      syncCardVisual(card);
    });
  }

  if (binsNumber) {
    binsNumber.addEventListener("input", () => {
      const raw = binsNumber.value.trim();
      if (raw === "") return; // пусто — ждём, пока пользователь допечатает
      const n = Number(raw);
      if (Number.isFinite(n) && n >= BINS_MIN && n <= BINS_MAX) {
        s.bins = Math.round(n);
        if (binsRange) binsRange.value = String(s.bins);
      }
    });
    const commitBins = () => {
      const n = clampBins(Number(binsNumber.value));
      s.bins = n;
      syncBinsInputs(n);
      syncCardVisual(card);
    };
    binsNumber.addEventListener("blur", commitBins);
    binsNumber.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        binsNumber.blur();
      }
    });
  }

  // ---------- Точность (slider + number) ----------
  const PRECISION_MIN = 0;
  const PRECISION_MAX = 5;

  const precisionRange = settingsContent.querySelector<HTMLInputElement>(
    "[data-precision-range]",
  );
  const precisionNumber = settingsContent.querySelector<HTMLInputElement>(
    "[data-precision-number]",
  );

  const clampPrecision = (n: number): number => {
    if (!Number.isFinite(n)) return s.precision;
    return Math.max(PRECISION_MIN, Math.min(PRECISION_MAX, Math.round(n)));
  };
  const syncPrecisionInputs = (n: number) => {
    if (precisionRange) precisionRange.value = String(n);
    if (precisionNumber) precisionNumber.value = String(n);
  };

  if (precisionRange) {
    precisionRange.addEventListener("input", () => {
      const n = clampPrecision(Number(precisionRange.value));
      s.precision = n;
      if (precisionNumber) precisionNumber.value = String(n);
      redrawActive(card);
    });
    precisionRange.addEventListener("change", () => {
      scheduleSaveVizState();
    });
  }

  if (precisionNumber) {
    precisionNumber.addEventListener("input", () => {
      const raw = precisionNumber.value.trim();
      if (raw === "") return;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= PRECISION_MIN && n <= PRECISION_MAX) {
        s.precision = Math.round(n);
        if (precisionRange) precisionRange.value = String(s.precision);
        redrawActive(card);
      }
    });
    const commitPrecision = () => {
      const n = clampPrecision(Number(precisionNumber.value));
      s.precision = n;
      syncPrecisionInputs(n);
      redrawActive(card);
      scheduleSaveVizState();
    };
    precisionNumber.addEventListener("blur", commitPrecision);
    precisionNumber.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        precisionNumber.blur();
      }
    });
  }

  // ---------- Сетка ----------
  const gridCheck = settingsContent.querySelector(
    '[data-setting="showGrid"]',
  ) as HTMLInputElement | null;
  if (gridCheck) {
    gridCheck.addEventListener("change", () => {
      s.showGrid = gridCheck.checked;
      redrawActive(card);
      scheduleSaveVizState();
    });
  }

  // ---------- Режим отрисовки (Grouped / Stacked) ----------
  const renderModeSelect = settingsContent.querySelector(
    '[data-setting="renderMode"]',
  ) as HTMLSelectElement | null;
  if (renderModeSelect) {
    renderModeSelect.addEventListener("change", () => {
      s.renderMode = renderModeSelect.value as "grouped" | "stacked";
      redrawActive(card);
      scheduleSaveVizState();
    });
  }

  // ---------- Top-N ----------
  const topNInput = settingsContent.querySelector(
    '[data-setting="topN"]',
  ) as HTMLInputElement | null;
  if (topNInput) {
    topNInput.addEventListener("change", () => {
      s.topN = Math.max(0, Number(topNInput.value) || 0);
      syncCardVisual(card);
      scheduleSaveVizState();
    });
  }

  // ---------- Удаление слота ----------
  settingsContent
    .querySelectorAll<HTMLButtonElement>("[data-remove-slot]")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = Number(btn.getAttribute("data-remove-slot")) as 0 | 1;
        card.settings.slots[i] = null;
        renderSettingsContent(cardId);
        syncCardVisual(card);
        scheduleSaveVizState();
      });
    });

  // ---------- Drop-зоны ----------
  settingsContent
    .querySelectorAll<HTMLElement>("[data-dropzone]")
    .forEach((zone) => {
      const i = Number(zone.getAttribute("data-dropzone")) as 0 | 1;
      setupDropzone(zone, card, i);
    });

  // ---------- Информационные значки «?» ----------
  settingsContent
    .querySelectorAll<HTMLElement>(".info-icon")
    .forEach((icon) => {
      icon.addEventListener("mouseenter", () => showInfoTooltip(icon));
      icon.addEventListener("mouseleave", hideInfoTooltip);
    });

  // ---------- Диапазоны данных ----------
  if (hasBuckets) {
    const addBtn = settingsContent.querySelector(
      "[data-add-bucket]",
    ) as HTMLButtonElement | null;
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        s.buckets.push(makeDefaultBucket(s.buckets.length));
        renderSettingsContent(cardId);
        scheduleSaveVizState();
      });
    }

    settingsContent
      .querySelectorAll<HTMLButtonElement>("[data-remove-bucket]")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (s.buckets.length <= 1) return;
          const cardEl = btn.closest(".bucket-card");
          const bucketId = cardEl?.getAttribute("data-bucket-id");
          if (!bucketId) return;
          const idx = s.buckets.findIndex((b) => b.id === bucketId);
          if (idx < 0) return;
          s.buckets.splice(idx, 1);
          renderSettingsContent(cardId);
          scheduleSaveVizState();
        });
      });

    settingsContent
      .querySelectorAll<HTMLElement>(".bucket-card")
      .forEach((cardEl) => {
        const bucketId = cardEl.getAttribute("data-bucket-id");
        if (!bucketId) return;
        const bucket = s.buckets.find((b) => b.id === bucketId);
        if (!bucket) return;

        const nameInput = cardEl.querySelector(
          "[data-bucket-name]",
        ) as HTMLInputElement | null;
        if (nameInput) {
          nameInput.addEventListener("input", () => {
            bucket.name = nameInput.value;
            redrawActive(card);
            scheduleSaveVizState();
          });
        }

        const opSelect = cardEl.querySelector(
          "[data-bucket-op]",
        ) as HTMLSelectElement | null;
        if (opSelect) {
          opSelect.addEventListener("change", () => {
            const nextOp = opSelect.value as BucketOperator;
            if (nextOp !== bucket.operator) {
              // "other" может быть только один. Если пользователь
              // выбрал "other" — сбрасываем его в остальных бакетах.
              if (nextOp === "other") {
                for (const other of s.buckets) {
                  if (other !== bucket && other.operator === "other") {
                    other.operator = "lt";
                    other.value1 = null;
                    other.value2 = null;
                  }
                }
              }
              bucket.operator = nextOp;
              if (nextOp === "range" && bucket.value2 == null) {
                bucket.value2 = bucket.value1;
              }
              // Очищаем ненужные значения при переключении на "other"
              if (nextOp === "other") {
                bucket.value1 = null;
                bucket.value2 = null;
              }
              renderSettingsContent(cardId);
              scheduleSaveVizState();
              syncCardVisual(card);
            }
          });
        }

        const v1Input = cardEl.querySelector(
          "[data-bucket-v1]",
        ) as HTMLInputElement | null;
        if (v1Input) {
          v1Input.addEventListener("input", () => {
            const raw = v1Input.value.trim();
            bucket.value1 = raw === "" ? null : Number(raw);
            if (Number.isNaN(bucket.value1)) bucket.value1 = null;
            scheduleSaveVizState();
          });
          v1Input.addEventListener("change", () => {
            syncCardVisual(card); // ← пересчёт на blur/enter
          });
        }

        const v2Input = cardEl.querySelector(
          "[data-bucket-v2]",
        ) as HTMLInputElement | null;
        if (v2Input) {
          v2Input.addEventListener("input", () => {
            const raw = v2Input.value.trim();
            bucket.value2 = raw === "" ? null : Number(raw);
            if (Number.isNaN(bucket.value2)) bucket.value2 = null;
            scheduleSaveVizState();
          });
          v2Input.addEventListener("change", () => {
            syncCardVisual(card); // ← пересчёт на blur/enter
          });
        }
      });

    const showNameCheck = settingsContent.querySelector(
      "[data-buckets-show-name]",
    ) as HTMLInputElement | null;
    if (showNameCheck) {
      showNameCheck.addEventListener("change", () => {
        s.bucketsShowName = showNameCheck.checked;
        redrawActive(card);
        scheduleSaveVizState();
      });
    }
  }
}

function renderSlotContent(slot: DataSlot | null, slotIndex: 0 | 1): string {
  if (!slot)
    return `<p class="settings-dropzone-empty">Перетащите колонку сюда</p>`;
  return `
    <div class="dropped-column">
      <div class="dropped-column-header">
        <span class="dropped-column-name">${escapeHtml(slot.name)}</span>
        <button class="dropped-column-remove"
                data-remove-slot="${slotIndex}"
                title="Убрать">×</button>
      </div>
    </div>
  `;
}

function setupDropzone(dropzone: HTMLElement, card: VizCard, slotIndex: 0 | 1) {
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", (e) => {
    if (e.target === dropzone) dropzone.classList.remove("dragover");
  });

  const reject = () => {
    dropzone.classList.add("reject");
    setTimeout(() => dropzone.classList.remove("reject"), 400);
  };

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");

    const raw = e.dataTransfer?.getData("application/x-sift-column");
    if (!raw || !currentData) return;
    const idx = Number(raw);
    if (Number.isNaN(idx)) return;

    const ct = currentData.columnTypes[idx];
    if (!ct) return;

    // ---- Проверка типа колонки под слот ----
    if (
      (card.vizId === "histogram" ||
        card.vizId === "histogram-buckets" ||
        card.vizId === "barchart" ||
        card.vizId === "barchart-buckets") &&
      slotIndex === 0 &&
      ct.type !== "numeric"
    ) {
      reject();
      return;
    }

    if (
      card.vizId === "histogram-grouped" ||
      card.vizId === "barchart-grouped"
    ) {
      if (slotIndex === 0 && ct.type !== "numeric") {
        reject();
        return;
      }
      if (
        slotIndex === 1 &&
        ct.type !== "string" &&
        ct.type !== "mixed" &&
        ct.type !== "boolean" &&
        ct.type !== "date" &&
        ct.type !== "datetime" &&
        ct.type !== "ordinal"
      ) {
        reject();
        return;
      }
    }

    // ---- Запрет дубликата ----
    const other = (slotIndex === 0 ? 1 : 0) as 0 | 1;
    if (card.settings.slots[other]?.columnIndex === idx) {
      reject();
      return;
    }

    card.settings.slots[slotIndex] = {
      columnIndex: idx,
      name: ct.name,
      legendText: ct.name,
    };

    renderSettingsContent(card.id);
    syncCardVisual(card);
    scheduleSaveVizState();
  });
}

// ============================================================
// СИНХРОНИЗАЦИЯ ВИЗУАЛИЗАЦИИ КАРТОЧКИ
// ============================================================

function syncCardVisual(card: VizCard) {
  if (card.vizId === "legend") {
    renderLegendCardBody(card);
    return;
  }

  const slot0 = card.settings.slots[0];

    if (card.vizId === "boxplot" && slot0 && currentData) {
    stopHistogramForCard(card.id);
    stopBarChartForCard(card.id);
    stopBucketedHistogramForCard(card.id);
    stopBucketedBarChartForCard(card.id);
    stopGroupedHistogramForCard(card.id);
    stopGroupedBarChartForCard(card.id);
    runBoxPlotForCard(card);
    return;
  }

  if (card.vizId === "histogram" && slot0 && currentData) {
    stopBarChartForCard(card.id);
    stopBucketedBarChartForCard(card.id);
    runHistogramForCard(card);
    return;
  }
  if (card.vizId === "histogram-buckets" && currentData) {
    stopBarChartForCard(card.id);
    stopBucketedBarChartForCard(card.id);
    runBucketedHistogramForCard(card);
    return;
  }

  if (card.vizId === "histogram-grouped" && currentData) {
    stopBarChartForCard(card.id);
    stopBucketedBarChartForCard(card.id);
    stopBucketedHistogramForCard(card.id);
    stopGroupedBarChartForCard(card.id);
    runGroupedHistogramForCard(card);
    return;
  }

  if (card.vizId === "barchart-grouped" && currentData) {
    stopHistogramForCard(card.id);
    stopBarChartForCard(card.id);
    stopBucketedBarChartForCard(card.id);
    stopBucketedHistogramForCard(card.id);
    runGroupedBarChartForCard(card);
    return;
  }
  if (card.vizId === "barchart" && slot0 && currentData) {
    stopHistogramForCard(card.id);
    stopBucketedBarChartForCard(card.id);
    runBarChartForCard(card);
    return;
  }

  if (card.vizId === "barchart-buckets" && currentData) {
    stopHistogramForCard(card.id);
    runBucketedBarChartForCard(card);
    return;
  }

  stopHistogramForCard(card.id);
  stopBarChartForCard(card.id);
  stopBucketedBarChartForCard(card.id);
  refreshCardBody(card);
}

function redrawActive(card: VizCard) {

    const boxPlot = runningBoxPlots.get(card.id);
  if (boxPlot) {
    boxPlot.redraw();
    return;
  }

  const groupedBar = runningGroupedBars.get(card.id);
  if (groupedBar) {
    groupedBar.redraw();
    return;
  }
  const grouped = runningGroupedHistograms.get(card.id);
  if (grouped) {
    grouped.redraw();
    return;
  }
  const bucketedBar = runningBucketedBars.get(card.id);
  if (bucketedBar) {
    bucketedBar.redraw();
    return;
  }
  const bucketed = runningBucketedHistograms.get(card.id);
  if (bucketed) {
    bucketed.redraw();
    return;
  }
  const hist = runningHistograms.get(card.id);
  if (hist) {
    hist.redraw();
    return;
  }
  const bar = runningBars.get(card.id);
  if (bar) {
    bar.redraw();
    return;
  }
  refreshCardBody(card);
}

// ============================================================
// ГИСТОГРАММА С ДИАПАЗОНАМИ
// ============================================================

interface BucketedHistogramRun {
  handle: BucketedHistogramHandle;
  canvas: HTMLCanvasElement;
  renderer: HistogramRenderer;
  lastState: BucketedHistogramChunkResult | null;
  observer: ResizeObserver;
  getXLabel: () => string;
  getYLabel: () => string;
  getLegendText: () => string;
  getBucketLabels: () => string[];
  tooltip: HTMLDivElement;
  onMove: (e: MouseEvent) => void;
  onLeave: () => void;
  extractionStats: ExtractionStats;
  issuesBadge: HTMLElement | null;
  redraw: () => void;
}

const runningBucketedHistograms = new Map<string, BucketedHistogramRun>();

function opToCode(op: BucketOperator): number {
  switch (op) {
    case "lt":
      return 0;
    case "lte":
      return 1;
    case "gt":
      return 2;
    case "gte":
      return 3;
    case "eq":
      return 4;
    case "neq":
      return 5;
    case "range":
      return 6;
    case "other":
      // Не отправляем в WASM — учтём отдельно через state.outOfBuckets.
      return -1;
  }
}

function getBucketLabel(b: Bucket, showName: boolean): string {
  if (showName && b.name.trim()) return b.name.trim();
  return formatBucketCondition(b);
}

/** Обёртка вокруг BucketedHistogramChunkResult — рисуем через HistogramRenderer. */
function toHistogramState(
  state: BucketedHistogramChunkResult,
): HistogramChunkResult {
  return {
    processed: state.processed,
    total: state.total,
    bins: state.buckets,
    counts: state.counts,
    min: 0,
    max: state.buckets,
    underflow: 0,
    overflow: state.outOfBuckets,
    done: state.done,
  };
}

function runBucketedHistogramForCard(card: VizCard) {
  stopBucketedHistogramForCard(card.id);
  stopHistogramForCard(card.id);
  stopBarChartForCard(card.id);

  const el = document.getElementById(card.id);
  const body = el?.querySelector(".viz-card-body") as HTMLElement | null;
  if (!body) return;

  if (!currentData) return;
  const slot = card.settings.slots[0];
  if (!slot) {
    body.innerHTML = `
      <div class="viz-stub">
        <div class="viz-stub-title">Выберите колонку</div>
        <div class="viz-stub-sub">Перетащите числовую колонку в блок «Данные» справа</div>
      </div>
    `;
    return;
  }

  const t0 = performance.now();
  const { values: data, stats } = extractNumericColumn(
    currentData,
    slot.columnIndex,
  );

  const buckets = card.settings.buckets;
  if (data.length === 0 || buckets.length === 0) return;

  const nB = buckets.length;

  const otherIdx = buckets.findIndex((b) => b.operator === "other");

  const ops = new Int32Array(nB);
  const v1s = new Float64Array(nB);
  const v2s = new Float64Array(nB);
  for (let i = 0; i < nB; ++i) {
    const b = buckets[i];
    if (b.operator === "other") {
      ops[i] = -1;
      continue;
    }
    const valid =
      b.value1 != null && (b.operator !== "range" || b.value2 != null);
    if (!valid) {
      ops[i] = -1;
      continue;
    }
    ops[i] = opToCode(b.operator);
    v1s[i] = b.value1!;
    v2s[i] = b.operator === "range" ? b.value2! : 0;
  }

  // Подставляет state.outOfBuckets в слот "other", если он есть.
  const processState = (
    state: BucketedHistogramChunkResult,
  ): BucketedHistogramChunkResult => {
    if (otherIdx < 0) return state;
    const countsCopy = [...state.counts];
    countsCopy[otherIdx] = state.outOfBuckets;
    return { ...state, counts: countsCopy, outOfBuckets: 0 };
  };

  // ---- Canvas ----
  body.innerHTML = '<canvas class="viz-canvas-2d"></canvas>';
  const canvas = body.querySelector("canvas") as HTMLCanvasElement;
  const renderer = new HistogramRenderer(canvas);

  const resizeCanvas = () => {
    const r = body.getBoundingClientRect();
    renderer.resize(r.width - 16, r.height - 16);
  };
  resizeCanvas();

  const getXLabel = () => {
    if (!card.settings.showAxisLabels) return "";
    return slot.legendText.trim();
  };
  const getYLabel = () => {
    if (!card.settings.showAxisLabels) return "";
    return card.settings.yLabelOverride.trim();
  };
  const getLegendText = () => {
    if (!card.settings.showLegend) return "";
    return card.settings.legendText.trim() || slot.name;
  };
  const getBucketLabels = (): string[] => {
    return card.settings.buckets.map((b) =>
      getBucketLabel(b, card.settings.bucketsShowName),
    );
  };

  const redraw = () => {
    const run = runningBucketedHistograms.get(card.id);
    const state = run?.lastState ?? null;
    const labels = getBucketLabels();

    if (!state) {
      renderer.draw(null, {
        xLabel: getXLabel(),
        yLabel: getYLabel(),
        legendText: getLegendText(),
        showGrid: card.settings.showGrid,
        showAxisLabels: card.settings.showAxisLabels,
        precision: card.settings.precision,
        binLabels: labels,
        placeholder: "Готовим первую порцию…",
      });
      return;
    }

    renderer.draw(toHistogramState(state), {
      xLabel: getXLabel(),
      yLabel: getYLabel(),
      legendText: getLegendText(),
      showGrid: card.settings.showGrid,
      showAxisLabels: card.settings.showAxisLabels,
      binLabels: labels,
      precision: card.settings.precision,
    });
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  observer.observe(body);

  // ---------- Tooltip ----------
  const tooltip = document.createElement("div");
  tooltip.className = "viz-tooltip hidden";
  document.body.appendChild(tooltip);

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      tooltip.classList.add("hidden");
      return;
    }
    const labels = getBucketLabels();
    const label =
      hit.binIndex >= 0 && hit.binIndex < labels.length
        ? labels[hit.binIndex]
        : "—";
    tooltip.innerHTML = `
      <div class="viz-tooltip-title">группа</div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">название</span>
        <span class="viz-tooltip-value">${escapeHtml(label)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">кол-во</span>
        <span class="viz-tooltip-value">${hit.count.toLocaleString("ru-RU")}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">доля</span>
        <span class="viz-tooltip-value">${(hit.frequency * 100).toFixed(2)}%</span>
      </div>
    `;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.remove("hidden");
  };

  const onLeave = () => tooltip.classList.add("hidden");

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  // ---------- Значок проблемных строк ----------
  const errorsCount = stats.nulls + stats.nans + stats.nonNumeric;
  const issuesHandle = el ? createIssuesBadge(el, card.id) : null;
  const issuesBadge: HTMLElement | null = issuesHandle?.el ?? null;

  // Инициально — только ошибки (warnings появятся по мере обработки)
  issuesHandle?.update(errorsCount, 0);

  const run: BucketedHistogramRun = {
    handle: { cancel: () => {} },
    canvas,
    renderer,
    lastState: null,
    observer,
    getXLabel,
    getYLabel,
    getLegendText,
    getBucketLabels,
    tooltip,
    onMove,
    onLeave,
    extractionStats: stats,
    issuesBadge,
    redraw,
  };
  runningBucketedHistograms.set(card.id, run);

  redraw();
  registerProgressRun(card.id, data.length);

  console.group(
    `%c[Bucketed histogram ${card.id}] колонка «${slot.name}»`,
    "color:#4a9eff;font-weight:bold",
  );
  console.log(`Групп: ${nB}`);
  console.log(`Числовых значений: ${data.length.toLocaleString("ru-RU")}`);
  console.groupEnd();

  const handle = runProgressiveBucketedHistogram({
    data,
    ops,
    v1s,
    v2s,
    numBuckets: nB,
    onProgress: (rawState) => {
      const state = processState(rawState);
      run.lastState = state;
      updateProgressRun(card.id, state.processed, state.total);
      issuesHandle?.update(errorsCount, state.outOfBuckets);
      redraw();
    },
    onDone: (rawState) => {
      const state = processState(rawState);
      run.lastState = state;
      finishProgressRun(card.id);
      issuesHandle?.update(errorsCount, state.outOfBuckets);
      redraw();

      const sum = state.counts.reduce((a, b) => a + b, 0);
      const elapsed = Math.round(performance.now() - t0);
      console.group(
        `%c[Bucketed histogram ${card.id}] готово за ${elapsed} мс`,
        "color:#16a34a;font-weight:bold",
      );
      console.log(`Обработано: ${state.total.toLocaleString("ru-RU")}`);
      console.log(`Сумма по группам: ${sum.toLocaleString("ru-RU")}`);
      console.log(`Вне групп: ${state.outOfBuckets.toLocaleString("ru-RU")}`);
      console.groupEnd();
    },
  });

  run.handle = handle;
}

function stopBucketedHistogramForCard(cardId: string) {
  const run = runningBucketedHistograms.get(cardId);
  if (!run) return;
  run.handle.cancel();
  run.observer.disconnect();
  run.canvas.removeEventListener("mousemove", run.onMove);
  run.canvas.removeEventListener("mouseleave", run.onLeave);
  run.tooltip.remove();
  if (run.issuesBadge) run.issuesBadge.remove();
  runningBucketedHistograms.delete(cardId);
  unregisterProgressRun(cardId);
}

function pluralizeBuckets(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "группа";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "группы";
  return "групп";
}

// ============================================================
// ПРОГРЕССИВНАЯ ГИСТОГРАММА — ИНТЕГРАЦИЯ
// ============================================================

interface BadRow {
  rowNumber: number;
  reason: "null" | "nan" | "nonNumeric";
  rawValue: string;
}

interface ExtractionStats {
  totalRows: number;
  valid: number;
  nulls: number;
  nans: number;
  nonNumeric: number;
  badRows: BadRow[];
}

// ============================================================
// ЛИНЕЙЧАТАЯ С ДИАПАЗОНАМИ
// ============================================================

interface BucketedBarChartRun {
  handle: BucketedHistogramHandle;
  canvas: HTMLCanvasElement;
  renderer: BarChartRenderer;
  lastState: BucketedHistogramChunkResult | null;
  observer: ResizeObserver;
  getXLabel: () => string;
  getYLabel: () => string;
  getLegendText: () => string;
  getBucketLabels: () => string[];
  tooltip: HTMLDivElement;
  onMove: (e: MouseEvent) => void;
  onLeave: () => void;
  extractionStats: ExtractionStats;
  issuesBadge: HTMLElement | null;
  redraw: () => void;
}

const runningBucketedBars = new Map<string, BucketedBarChartRun>();

function runBucketedBarChartForCard(card: VizCard) {
  stopBucketedBarChartForCard(card.id);
  stopHistogramForCard(card.id);
  stopBarChartForCard(card.id);
  stopBucketedHistogramForCard(card.id);

  const el = document.getElementById(card.id);
  const body = el?.querySelector(".viz-card-body") as HTMLElement | null;
  if (!body) return;

  if (!currentData) return;
  const slot = card.settings.slots[0];
  if (!slot) {
    body.innerHTML = `
      <div class="viz-stub">
        <div class="viz-stub-title">Выберите колонку</div>
        <div class="viz-stub-sub">Перетащите числовую колонку в блок «Данные» справа</div>
      </div>
    `;
    return;
  }

  const t0 = performance.now();
  const { values: data, stats } = extractNumericColumn(
    currentData,
    slot.columnIndex,
  );

  const buckets = card.settings.buckets;
  if (data.length === 0 || buckets.length === 0) return;

  const nB = buckets.length;

  const otherIdx = buckets.findIndex((b) => b.operator === "other");

  // --- ops, v1s, v2s из buckets ---
  const ops = new Int32Array(nB);
  const v1s = new Float64Array(nB);
  const v2s = new Float64Array(nB);
  for (let i = 0; i < nB; ++i) {
    const b = buckets[i];
    if (b.operator === "other") {
      ops[i] = -1;
      continue;
    }
    const valid =
      b.value1 != null && (b.operator !== "range" || b.value2 != null);
    if (!valid) {
      ops[i] = -1;
      continue;
    }
    ops[i] = opToCode(b.operator);
    v1s[i] = b.value1!;
    v2s[i] = b.operator === "range" ? b.value2! : 0;
  }

  const processState = (
    state: BucketedHistogramChunkResult,
  ): BucketedHistogramChunkResult => {
    if (otherIdx < 0) return state;
    const countsCopy = [...state.counts];
    countsCopy[otherIdx] = state.outOfBuckets;
    return { ...state, counts: countsCopy, outOfBuckets: 0 };
  };

  // ---- Canvas ----
  body.innerHTML = '<canvas class="viz-canvas-2d"></canvas>';
  const canvas = body.querySelector("canvas") as HTMLCanvasElement;
  const renderer = new BarChartRenderer(canvas);

  const resizeCanvas = () => {
    const r = body.getBoundingClientRect();
    renderer.resize(r.width - 16, r.height - 16);
  };
  resizeCanvas();

  // Для bar chart: ось X — частоты (yLabelOverride),
  // ось Y — значения (legendText слота).
  const getXLabel = () => {
    if (!card.settings.showAxisLabels) return "";
    return card.settings.yLabelOverride.trim();
  };
  const getYLabel = () => {
    if (!card.settings.showAxisLabels) return "";
    return slot.legendText.trim();
  };
  const getLegendText = () => {
    if (!card.settings.showLegend) return "";
    return card.settings.legendText.trim() || slot.name;
  };
  const getBucketLabels = (): string[] => {
    return card.settings.buckets.map((b) =>
      getBucketLabel(b, card.settings.bucketsShowName),
    );
  };

  const redraw = () => {
    const run = runningBucketedBars.get(card.id);
    const state = run?.lastState ?? null;
    const labels = getBucketLabels();

    if (!state) {
      renderer.draw(null, {
        xLabel: getXLabel(),
        yLabel: getYLabel(),
        legendText: getLegendText(),
        showGrid: card.settings.showGrid,
        showAxisLabels: card.settings.showAxisLabels,
        preserveOrder: true,
        precision: card.settings.precision,
        placeholder: "Готовим первую порцию…",
      });
      return;
    }

    const categories: BarChartCategory[] = labels.map((label, i) => ({
      label,
      value: state.counts[i] ?? 0,
    }));

    renderer.draw(
      { categories, metricLabel: "Частота" },
      {
        xLabel: getXLabel(),
        yLabel: getYLabel(),
        legendText: getLegendText(),
        showGrid: card.settings.showGrid,
        showAxisLabels: card.settings.showAxisLabels,
        preserveOrder: true,
        precision: card.settings.precision,
        processed: state.processed,
        total: state.total,
        outOfBuckets: state.outOfBuckets,
      },
    );
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  observer.observe(body);

  // ---------- Tooltip ----------
  const tooltip = document.createElement("div");
  tooltip.className = "viz-tooltip hidden";
  document.body.appendChild(tooltip);

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      tooltip.classList.add("hidden");
      return;
    }
    tooltip.innerHTML = `
      <div class="viz-tooltip-title">группа</div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">название</span>
        <span class="viz-tooltip-value">${escapeHtml(hit.label)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">кол-во</span>
        <span class="viz-tooltip-value">${hit.value.toLocaleString("ru-RU")}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">доля</span>
        <span class="viz-tooltip-value">${(hit.percentage * 100).toFixed(2)}%</span>
      </div>
    `;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.remove("hidden");
  };

  const onLeave = () => tooltip.classList.add("hidden");

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  // ---------- Значок проблемных строк ----------
  const errorsCount = stats.nulls + stats.nans + stats.nonNumeric;
  const issuesHandle = el ? createIssuesBadge(el, card.id) : null;
  const issuesBadge: HTMLElement | null = issuesHandle?.el ?? null;
  issuesHandle?.update(errorsCount, 0);

  const run: BucketedBarChartRun = {
    handle: { cancel: () => {} },
    canvas,
    renderer,
    lastState: null,
    observer,
    getXLabel,
    getYLabel,
    getLegendText,
    getBucketLabels,
    tooltip,
    onMove,
    onLeave,
    extractionStats: stats,
    issuesBadge,
    redraw,
  };
  runningBucketedBars.set(card.id, run);

  redraw();
  registerProgressRun(card.id, data.length);

  console.group(
    `%c[Bucketed bar ${card.id}] колонка «${slot.name}»`,
    "color:#4a9eff;font-weight:bold",
  );
  console.log(`Групп: ${nB}`);
  console.log(`Числовых значений: ${data.length.toLocaleString("ru-RU")}`);
  console.groupEnd();

  const handle = runProgressiveBucketedHistogram({
    data,
    ops,
    v1s,
    v2s,
    numBuckets: nB,
    onProgress: (rawState) => {
      const state = processState(rawState);
      run.lastState = state;
      updateProgressRun(card.id, state.processed, state.total);
      issuesHandle?.update(errorsCount, state.outOfBuckets);
      redraw();
    },
    onDone: (rawState) => {
      const state = processState(rawState);
      run.lastState = state;
      finishProgressRun(card.id);
      issuesHandle?.update(errorsCount, state.outOfBuckets);
      redraw();

      const sum = state.counts.reduce((a, b) => a + b, 0);
      const elapsed = Math.round(performance.now() - t0);
      console.group(
        `%c[Bucketed bar ${card.id}] готово за ${elapsed} мс`,
        "color:#16a34a;font-weight:bold",
      );
      console.log(`Обработано: ${state.total.toLocaleString("ru-RU")}`);
      console.log(`Сумма по группам: ${sum.toLocaleString("ru-RU")}`);
      console.log(`Вне групп: ${state.outOfBuckets.toLocaleString("ru-RU")}`);
      console.groupEnd();
    },
  });

  run.handle = handle;
}

function stopBucketedBarChartForCard(cardId: string) {
  const run = runningBucketedBars.get(cardId);
  if (!run) return;
  run.handle.cancel();
  run.observer.disconnect();
  run.canvas.removeEventListener("mousemove", run.onMove);
  run.canvas.removeEventListener("mouseleave", run.onLeave);
  run.tooltip.remove();
  if (run.issuesBadge) run.issuesBadge.remove();
  runningBucketedBars.delete(cardId);
  unregisterProgressRun(cardId);
}

interface HistogramRun {
  handle: HistogramHandle;
  canvas: HTMLCanvasElement;
  renderer: HistogramRenderer;
  lastState: HistogramChunkResult | null;
  observer: ResizeObserver;
  getXLabel: () => string;
  getYLabel: () => string;
  tooltip: HTMLDivElement;
  onMove: (e: MouseEvent) => void;
  onLeave: () => void;
  extractionStats: ExtractionStats;
  issuesBadge: HTMLElement | null;
  /** Перерисовка с текущими настройками (включая top-N). */
  redraw: () => void;
}

const runningHistograms = new Map<string, HistogramRun>();

const MAX_BAD_ROWS = 1000;

// Если серий больше, чем это число — встроенная легенда не рисуется,
// вместо неё показывается бейдж «Легенда (N)» с модалкой.
const MAX_INLINE_LEGEND_ITEMS = 6;

function extractNumericColumn(
  data: ParsedData,
  columnIndex: number,
): { values: Float64Array; stats: ExtractionStats } {
  const rows = data.rows;
  const tmp = new Float64Array(rows.length);
  let n = 0;

  const stats: ExtractionStats = {
    totalRows: rows.length,
    valid: 0,
    nulls: 0,
    nans: 0,
    nonNumeric: 0,
    badRows: [],
  };

  const pushBad = (
    rowNumber: number,
    reason: BadRow["reason"],
    rawValue: string,
  ) => {
    if (stats.badRows.length < MAX_BAD_ROWS) {
      stats.badRows.push({ rowNumber, reason, rawValue });
    }
  };

  for (let i = 0; i < rows.length; ++i) {
    const v = rows[i][columnIndex];
    const rowNumber = i + 1;

    // null / undefined
    if (v == null) {
      stats.nulls++;
      pushBad(rowNumber, "null", "");
      continue;
    }

    // number
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        stats.nans++;
        pushBad(rowNumber, "nan", String(v));
        continue;
      }
      tmp[n++] = v;
      stats.valid++;
      continue;
    }

    // string
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed === "") {
        stats.nulls++;
        pushBad(rowNumber, "null", "");
        continue;
      }
      const num = Number(trimmed);
      if (!Number.isFinite(num)) {
        stats.nonNumeric++;
        pushBad(rowNumber, "nonNumeric", trimmed);
        continue;
      }
      tmp[n++] = num;
      stats.valid++;
      continue;
    }

    // boolean / object / прочее
    const num = Number(v);
    if (!Number.isFinite(num)) {
      stats.nonNumeric++;
      pushBad(rowNumber, "nonNumeric", String(v));
      continue;
    }
    tmp[n++] = num;
    stats.valid++;
  }

  return { values: tmp.slice(0, n), stats };
}

// ============================================================
// ЗНАЧОК ПРОБЛЕМНЫХ СТРОК (общий для всех визуализаций)
// ============================================================

interface IssuesBadgeHandle {
  el: HTMLElement;
  update: (errors: number, warnings: number) => void;
}

function createIssuesBadge(
  cardEl: HTMLElement,
  cardId: string,
): IssuesBadgeHandle | null {
  const header = cardEl.querySelector(".viz-card-header");
  const closeBtn = header?.querySelector(".viz-card-close");
  if (!header || !closeBtn) return null;

  const badge = document.createElement("div");
  badge.className = "viz-card-issues-badge hidden";
  badge.title = "Проблемные строки — нажмите, чтобы посмотреть";
  badge.innerHTML = `
    <span class="issues-part errors hidden">
      <span class="issues-triangle errors">⚠</span>
      <span class="issues-count" data-errors-count>0</span>
    </span>
    <span class="issues-part warnings hidden">
      <span class="issues-triangle warnings">⚠</span>
      <span class="issues-count" data-warnings-count>0</span>
    </span>
  `;
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    openBadRowsModal(cardId);
  });
  badge.addEventListener("dblclick", (e) => e.stopPropagation());

  header.insertBefore(badge, closeBtn);

  const errorsPart = badge.querySelector(".issues-part.errors") as HTMLElement;
  const warningsPart = badge.querySelector(
    ".issues-part.warnings",
  ) as HTMLElement;
  const errorsCountEl = badge.querySelector(
    "[data-errors-count]",
  ) as HTMLElement;
  const warningsCountEl = badge.querySelector(
    "[data-warnings-count]",
  ) as HTMLElement;

  return {
    el: badge,
    update(errors: number, warnings: number) {
      if (errors === 0 && warnings === 0) {
        badge.classList.add("hidden");
        return;
      }
      badge.classList.remove("hidden");

      if (errors > 0) {
        errorsPart.classList.remove("hidden");
        errorsCountEl.textContent = errors.toLocaleString("ru-RU");
      } else {
        errorsPart.classList.add("hidden");
      }

      if (warnings > 0) {
        warningsPart.classList.remove("hidden");
        warningsCountEl.textContent = warnings.toLocaleString("ru-RU");
      } else {
        warningsPart.classList.add("hidden");
      }
    },
  };
}

/**
 * Компактный бейдж «Легенда (N)» в шапке карточки.
 * Видим, только если:
 *   - это grouped-визуализация,
 *   - задан слот группировки,
 *   - серий больше, чем MAX_INLINE_LEGEND_ITEMS.
 */
interface LegendBadgeHandle {
  el: HTMLElement;
  update: (seriesCount: number) => void;
}

function createLegendBadge(cardEl: HTMLElement): LegendBadgeHandle | null {
  const header = cardEl.querySelector(".viz-card-header");
  const closeBtn = header?.querySelector(".viz-card-close");
  if (!header || !closeBtn) return null;

  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "viz-card-legend-badge hidden";
  badge.title = "Открыть полную легенду";
  badge.innerHTML = `Легенда <span class="legend-badge-count">0</span>`;
  badge.addEventListener("pointerdown", (e) => e.stopPropagation());
  badge.addEventListener("dblclick", (e) => e.stopPropagation());
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    openOrFocusLegendCard(cardEl.id);
  });

  // Вставляем слева от close
  header.insertBefore(badge, closeBtn);

  const countEl = badge.querySelector(".legend-badge-count") as HTMLElement;

  return {
    el: badge,
    update(seriesCount: number) {
      if (seriesCount > MAX_INLINE_LEGEND_ITEMS) {
        countEl.textContent = String(seriesCount);
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    },
  };
}

function runHistogramForCard(card: VizCard) {
  stopHistogramForCard(card.id);

  if (!currentData) return;
  const slot = card.settings.slots[0];
  if (!slot) return;

  const t0 = performance.now();
  const { values: data, stats } = extractNumericColumn(
    currentData,
    slot.columnIndex,
  );

  if (data.length === 0) {
    console.warn(
      `[Гистограмма ${card.id}] нет числовых значений в колонке «${slot.name}»`,
    );
    return;
  }

  const el = document.getElementById(card.id);
  const body = el?.querySelector(".viz-card-body") as HTMLElement | null;
  if (!body) return;

  body.innerHTML = '<canvas class="viz-canvas-2d"></canvas>';
  const canvas = body.querySelector("canvas") as HTMLCanvasElement;
  const renderer = new HistogramRenderer(canvas);

  const resizeCanvas = () => {
    const r = body.getBoundingClientRect();
    renderer.resize(r.width - 16, r.height - 16);
  };
  resizeCanvas();

  const getXLabel = () => {
    const s = card.settings.slots[0];
    if (!s || !card.settings.showAxisLabels) return "";
    return s.legendText.trim();
  };
  const getYLabel = () => {
    if (!card.settings.showAxisLabels) return "";
    return card.settings.yLabelOverride.trim();
  };
  const getLegendText = () => {
    if (!card.settings.showLegend) return "";
    const s = card.settings.slots[0];
    if (!s) return "";
    return card.settings.legendText.trim() || s.name;
  };

  // Актуальные метки для tooltip (закрытие — чтобы tooltip видел их свежими)
  let currentLabels: string[] = [];

  const applyTopN = (
    state: HistogramChunkResult,
  ): { filtered: HistogramChunkResult; labels: string[] } => {
    const topN = card.settings.topN;
    const totalBins = state.counts.length;
    if (totalBins === 0) return { filtered: state, labels: [] };

    const binWidth = (state.max - state.min) / totalBins;
    const prec = card.settings.precision;

    const allLabels: string[] = [];
    for (let i = 0; i < totalBins; ++i) {
      const lo = state.min + i * binWidth;
      const hi = lo + binWidth;
      allLabels.push(
        `${formatNumberPrecise(lo, prec)}–${formatNumberPrecise(hi, prec)}`,
      );
    }

    if (topN <= 0 || topN >= totalBins) {
      return { filtered: state, labels: allLabels };
    }

    const indexed = state.counts.map((c, i) => ({ c, i }));
    indexed.sort((a, b) => b.c - a.c);
    const topSet = new Set(indexed.slice(0, topN).map((x) => x.i));
    const keptIdx = Array.from(topSet).sort((a, b) => a - b);

    const newCounts = keptIdx.map((i) => state.counts[i]);
    const newLabels = keptIdx.map((i) => allLabels[i]);

    return {
      filtered: { ...state, counts: newCounts, bins: newCounts.length },
      labels: newLabels,
    };
  };

  const redraw = () => {
    const run = runningHistograms.get(card.id);
    const state = run?.lastState ?? null;

    if (!state) {
      currentLabels = [];
      renderer.draw(null, {
        xLabel: getXLabel(),
        yLabel: getYLabel(),
        legendText: getLegendText(),
        showGrid: card.settings.showGrid,
        showAxisLabels: card.settings.showAxisLabels,
        precision: card.settings.precision,
        placeholder: "Готовим первую порцию…",
      });
      return;
    }

    const { filtered, labels } = applyTopN(state);
    currentLabels = labels;
    renderer.draw(filtered, {
      xLabel: getXLabel(),
      yLabel: getYLabel(),
      legendText: getLegendText(),
      showGrid: card.settings.showGrid,
      showAxisLabels: card.settings.showAxisLabels,
      binLabels: labels,
      precision: card.settings.precision,
    });
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  observer.observe(body);

  // ---------- Tooltip ----------
  const tooltip = document.createElement("div");
  tooltip.className = "viz-tooltip hidden";
  document.body.appendChild(tooltip);

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      tooltip.classList.add("hidden");
      return;
    }
    const label =
      hit.binIndex >= 0 && hit.binIndex < currentLabels.length
        ? currentLabels[hit.binIndex]
        : "—";
    tooltip.innerHTML = `
      <div class="viz-tooltip-title">диапазон</div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">значения</span>
        <span class="viz-tooltip-value">${escapeHtml(label)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">кол-во</span>
        <span class="viz-tooltip-value">${hit.count.toLocaleString("ru-RU")}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">доля</span>
        <span class="viz-tooltip-value">${(hit.frequency * 100).toFixed(2)}%</span>
      </div>
    `;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.remove("hidden");
  };

  const onLeave = () => tooltip.classList.add("hidden");

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  // ---------- Значок bad rows ----------
  const errorsCount = stats.nulls + stats.nans + stats.nonNumeric;
  const issuesHandle = el ? createIssuesBadge(el, card.id) : null;
  issuesHandle?.update(errorsCount, 0);
  const issuesBadge: HTMLElement | null = issuesHandle?.el ?? null;

  const run: HistogramRun = {
    handle: { cancel: () => {} },
    canvas,
    renderer,
    lastState: null,
    observer,
    getXLabel,
    getYLabel,
    tooltip,
    onMove,
    onLeave,
    extractionStats: stats,
    issuesBadge,
    redraw,
  };
  runningHistograms.set(card.id, run);

  redraw();
  registerProgressRun(card.id, data.length);

  const handle = runProgressiveHistogram({
    data,
    bins: card.settings.bins,
    onProgress: (state) => {
      run.lastState = state;
      updateProgressRun(card.id, state.processed, state.total);
      redraw();
    },
    onDone: (state) => {
      run.lastState = state;
      finishProgressRun(card.id);
      redraw();

      const sum = state.counts.reduce((a, b) => a + b, 0);
      const elapsed = Math.round(performance.now() - t0);
      console.group(
        `%c[Гистограмма ${card.id}] готово за ${elapsed} мс`,
        "color:#16a34a;font-weight:bold",
      );
      console.log(`Обработано: ${state.total.toLocaleString("ru-RU")}`);
      console.log(`Сумма по бинам: ${sum.toLocaleString("ru-RU")}`);
      console.log(`Бинов всего: ${state.counts.length}`);
      if (card.settings.topN > 0)
        console.log(`Показано топ-${card.settings.topN}`);
      console.groupEnd();
    },
  });

  run.handle = handle;
}

// ============================================================
// ГРУППИРОВАННАЯ ГИСТОГРАММА — ИНТЕГРАЦИЯ
// ============================================================

interface GroupedHistogramRun {
  handle: GroupedHistogramHandle;
  canvas: HTMLCanvasElement;
  renderer: GroupedHistogramRenderer;
  lastState: GroupedHistogramChunkResult | null;
  observer: ResizeObserver;
  getXLabel: () => string;
  getYLabel: () => string;
  getBinLabels: () => string[];
  getSeriesNames: () => string[];
  tooltip: HTMLDivElement;
  onMove: (e: MouseEvent) => void;
  onLeave: () => void;
  extractionStats: ExtractionStats;
  issuesBadge: HTMLElement | null;
  redraw: () => void;
}

const runningGroupedHistograms = new Map<string, GroupedHistogramRun>();

// ============================================================
// ЛИНЕЙЧАТАЯ С НАКОПЛЕНИЕМ — ИНТЕГРАЦИЯ
// ============================================================

interface GroupedBarChartRun {
  handle: GroupedHistogramHandle;
  canvas: HTMLCanvasElement;
  renderer: GroupedBarChartRenderer;
  lastState: GroupedHistogramChunkResult | null;
  observer: ResizeObserver;
  getXLabel: () => string;
  getYLabel: () => string;
  getBinLabels: () => string[];
  getSeriesNames: () => string[];
  tooltip: HTMLDivElement;
  onMove: (e: MouseEvent) => void;
  onLeave: () => void;
  extractionStats: ExtractionStats;
  issuesBadge: HTMLElement | null;
  redraw: () => void;
}

const runningGroupedBars = new Map<string, GroupedBarChartRun>();

function runGroupedBarChartForCard(card: VizCard) {
  stopGroupedBarChartForCard(card.id);

  const el = document.getElementById(card.id);
  const body = el?.querySelector(".viz-card-body") as HTMLElement | null;
  if (!body) return;

  if (!currentData) return;
  const slotNum = card.settings.slots[0];
  const slotCat = card.settings.slots[1];

  if (!slotNum || !slotCat) {
    body.innerHTML = `
      <div class="viz-stub">
        <div class="viz-stub-title">Выберите колонки</div>
        <div class="viz-stub-sub">Перетащите числовую и категориальную колонки в настройки</div>
      </div>
    `;
    return;
  }

  const buckets = card.settings.buckets;
  if (buckets.length === 0) return;
  const nB = buckets.length;

  const rows = currentData.rows;
  const tmpData = new Float64Array(rows.length);
  const tmpCatStrings = new Array<string>(rows.length);
  let n = 0;

  const stats: ExtractionStats = {
    totalRows: rows.length,
    valid: 0,
    nulls: 0,
    nans: 0,
    nonNumeric: 0,
    badRows: [],
  };
  const pushBad = (
    rowNumber: number,
    reason: BadRow["reason"],
    rawValue: string,
  ) => {
    if (stats.badRows.length < MAX_BAD_ROWS) {
      stats.badRows.push({ rowNumber, reason, rawValue });
    }
  };

  for (let i = 0; i < rows.length; ++i) {
    const rawNum = rows[i][slotNum.columnIndex];
    const rawCat = rows[i][slotCat.columnIndex];
    const rowNumber = i + 1;

    let num: number;
    if (rawNum == null) {
      stats.nulls++;
      pushBad(rowNumber, "null", "");
      continue;
    }
    if (typeof rawNum === "number") {
      if (!Number.isFinite(rawNum)) {
        stats.nans++;
        pushBad(rowNumber, "nan", String(rawNum));
        continue;
      }
      num = rawNum;
    } else {
      const s = String(rawNum).trim();
      if (s === "") {
        stats.nulls++;
        pushBad(rowNumber, "null", "");
        continue;
      }
      const parsed = Number(s);
      if (!Number.isFinite(parsed)) {
        stats.nonNumeric++;
        pushBad(rowNumber, "nonNumeric", s);
        continue;
      }
      num = parsed;
    }

    if (rawCat == null) continue;
    const catStr = String(rawCat).trim();
    if (catStr === "") continue;

    tmpData[n] = num;
    tmpCatStrings[n] = catStr;
    n++;
    stats.valid++;
  }

  if (n === 0) return;

  const finalData = tmpData.slice(0, n);
  const catsList = tmpCatStrings.slice(0, n);

  const catCounts = new Map<string, number>();
  for (const c of catsList) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);

  // Ordinal — порядок по словарю шкалы, остальное — по частоте.
  const catColType = currentData.columnTypes[slotCat.columnIndex]?.type;
  let sortedCats: string[];
  if (catColType === "ordinal") {
    const ordered = orderOrdinalValues(Array.from(catCounts.keys()));
    sortedCats =
      ordered ??
      Array.from(catCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);
  } else {
    sortedCats = Array.from(catCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }

  const topN = card.settings.topN;
  const activeCats = topN > 0 ? sortedCats.slice(0, topN) : sortedCats;
  const activeIdx = new Map(
    activeCats.map((name, idx) => [name, idx] as const),
  );

  const finalCatIndices = new Int32Array(n);
  for (let i = 0; i < n; ++i) {
    const idx = activeIdx.get(catsList[i]);
    finalCatIndices[i] = idx === undefined ? -1 : idx;
  }

  if (activeCats.length === 0) return;

  const otherIdx = buckets.findIndex((b) => b.operator === "other");

  const ops = new Int32Array(nB);
  const v1s = new Float64Array(nB);
  const v2s = new Float64Array(nB);
  for (let i = 0; i < nB; ++i) {
    const b = buckets[i];
    if (b.operator === "other") {
      ops[i] = -1;
      continue;
    }
    const valid =
      b.value1 != null && (b.operator !== "range" || b.value2 != null);
    if (!valid) {
      ops[i] = -1;
      continue;
    }
    ops[i] = opToCode(b.operator);
    v1s[i] = b.value1!;
    v2s[i] = b.operator === "range" ? b.value2! : 0;
  }

  body.innerHTML = '<canvas class="viz-canvas-2d"></canvas>';
  const canvas = body.querySelector("canvas") as HTMLCanvasElement;
  const renderer = new GroupedBarChartRenderer(canvas);

  const resizeCanvas = () => {
    const r = body.getBoundingClientRect();
    renderer.resize(r.width - 16, r.height - 16);
  };
  resizeCanvas();

  // Для bar chart: ось X — частоты (yLabelOverride),
  // ось Y — диапазоны (legendText слота 0).
  const getXLabel = () =>
    card.settings.showAxisLabels ? card.settings.yLabelOverride.trim() : "";
  const getYLabel = () =>
    card.settings.showAxisLabels
      ? (slotNum.legendText || slotNum.name).trim()
      : "";

  const getBinLabels = (): string[] =>
    card.settings.buckets.map((b) =>
      getBucketLabel(b, card.settings.bucketsShowName),
    );

  // Имена серий нужны не только для легенды, но и для tooltip.
  // Поэтому всегда возвращаем полный список, а видимость легенды
  // контролируется отдельным флагом `showLegend` в draw-опциях.
  const getSeriesNames = (): string[] => activeCats;

  const redraw = () => {
    const run = runningGroupedHistograms.get(card.id);
    const state = run?.lastState ?? null;
    const names = getSeriesNames();

    // Если серий больше порога — inline-легенда отключается,
    // вместо неё показывается бейдж + модалка.
    const inlineLegend =
      card.settings.showLegend && names.length <= MAX_INLINE_LEGEND_ITEMS;

    renderer.draw(state, {
      xLabel: getXLabel(),
      yLabel: getYLabel(),
      showGrid: card.settings.showGrid,
      showAxisLabels: card.settings.showAxisLabels,
      showLegend: inlineLegend,
      precision: card.settings.precision,
      renderMode: card.settings.renderMode,
      seriesNames: names,
      binLabels: getBinLabels(),
      placeholder: "Готовим первую порцию…",
    });
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  observer.observe(body);

  // ---- Расчёт «other» в JS ---- (та же логика, что и в grouped histogram)
  const computeOtherCounts = (): number[] | null => {
    if (otherIdx < 0) return null;
    const counts = new Array<number>(activeCats.length).fill(0);

    for (let i = 0; i < finalData.length; i++) {
      const v = finalData[i];
      let matched = false;
      for (let bi = 0; bi < nB; bi++) {
        if (bi === otherIdx) continue;
        if (ops[bi] === -1) continue;
        const op = buckets[bi];
        if (matchesBucket(v, op)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        const ci = finalCatIndices[i];
        if (ci >= 0 && ci < counts.length) counts[ci]++;
      }
    }
    return counts;
  };

  const errorsCount = stats.nulls + stats.nans + stats.nonNumeric;
  const issuesHandle = el ? createIssuesBadge(el, card.id) : null;
  issuesHandle?.update(errorsCount, 0);

  const tooltip = document.createElement("div");
  tooltip.className = "viz-tooltip hidden";
  document.body.appendChild(tooltip);

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      tooltip.classList.add("hidden");
      return;
    }
    tooltip.innerHTML = `
      <div class="viz-tooltip-title">сегмент</div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">диапазон</span>
        <span class="viz-tooltip-value">${escapeHtml(hit.bucketLabel)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">серия</span>
        <span class="viz-tooltip-value">${escapeHtml(hit.seriesName)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">кол-во</span>
        <span class="viz-tooltip-value">${hit.value.toLocaleString("ru-RU")}</span>
      </div>
    `;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.remove("hidden");
  };

  const onLeave = () => tooltip.classList.add("hidden");

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  const run: GroupedBarChartRun = {
    handle: { cancel: () => {} },
    canvas,
    renderer,
    lastState: null,
    observer,
    getXLabel,
    getYLabel,
    getBinLabels,
    getSeriesNames,
    tooltip,
    onMove,
    onLeave,
    extractionStats: stats,
    issuesBadge: issuesHandle?.el ?? null,
    redraw,
  };
  runningGroupedBars.set(card.id, run);

  redraw();
  registerProgressRun(card.id, finalData.length);

  const handle = runProgressiveGroupedHistogram({
    data: finalData,
    catIndices: finalCatIndices,
    numCategories: activeCats.length,
    ops,
    v1s,
    v2s,
    numBuckets: nB,
    onProgress: (state) => {
      run.lastState = state;
      updateProgressRun(card.id, state.processed, state.total);
      issuesHandle?.update(errorsCount, state.outOfBuckets);
      legendBadges.get(card.id)?.update(activeCats.length);
      refreshLinkedLegends(card.id);
      redraw();
    },
    onDone: (rawState) => {
      let state = rawState;

      // Досчитываем "other" — общий outOfBuckets раскладываем
      // по категориям вручную.
      const otherCounts = computeOtherCounts();
      if (otherCounts && otherIdx >= 0) {
        const countsCopy = [...state.counts];
        for (let ci = 0; ci < otherCounts.length; ci++) {
          countsCopy[otherIdx * activeCats.length + ci] = otherCounts[ci];
        }
        state = { ...state, counts: countsCopy, outOfBuckets: 0 };
      }

      run.lastState = state;
      finishProgressRun(card.id);
      issuesHandle?.update(errorsCount, state.outOfBuckets);
      legendBadges.get(card.id)?.update(activeCats.length);
      refreshLinkedLegends(card.id);
      redraw();
    },
  });

  run.handle = handle;
}

function stopGroupedBarChartForCard(cardId: string) {
  const run = runningGroupedBars.get(cardId);
  if (!run) return;
  run.handle.cancel();
  run.observer.disconnect();
  run.canvas.removeEventListener("mousemove", run.onMove);
  run.canvas.removeEventListener("mouseleave", run.onLeave);
  run.tooltip.remove();
  if (run.issuesBadge) run.issuesBadge.remove();
  runningGroupedBars.delete(cardId);
  unregisterProgressRun(cardId);
}

function runGroupedHistogramForCard(card: VizCard) {
  stopGroupedHistogramForCard(card.id);

  const el = document.getElementById(card.id);
  const body = el?.querySelector(".viz-card-body") as HTMLElement | null;
  if (!body) return;

  if (!currentData) return;
  const slotNum = card.settings.slots[0];
  const slotCat = card.settings.slots[1];

  if (!slotNum || !slotCat) {
    body.innerHTML = `
      <div class="viz-stub">
        <div class="viz-stub-title">Выберите колонки</div>
        <div class="viz-stub-sub">Перетащите числовую и категориальную колонки в настройки</div>
      </div>
    `;
    return;
  }

  const buckets = card.settings.buckets;
  if (buckets.length === 0) return;
  const nB = buckets.length;

  // Параллельно собираем числовые значения и категории — только те строки,
  // где ОБА поля валидны. Это гарантирует, что data[i] ↔ cat[i].
  const rows = currentData.rows;
  const tmpData = new Float64Array(rows.length);
  const tmpCatStrings = new Array<string>(rows.length);
  let n = 0;

  const stats: ExtractionStats = {
    totalRows: rows.length,
    valid: 0,
    nulls: 0,
    nans: 0,
    nonNumeric: 0,
    badRows: [],
  };
  const pushBad = (
    rowNumber: number,
    reason: BadRow["reason"],
    rawValue: string,
  ) => {
    if (stats.badRows.length < MAX_BAD_ROWS) {
      stats.badRows.push({ rowNumber, reason, rawValue });
    }
  };

  for (let i = 0; i < rows.length; ++i) {
    const rawNum = rows[i][slotNum.columnIndex];
    const rawCat = rows[i][slotCat.columnIndex];
    const rowNumber = i + 1;

    // --- числовая колонка ---
    let num: number;
    if (rawNum == null) {
      stats.nulls++;
      pushBad(rowNumber, "null", "");
      continue;
    }
    if (typeof rawNum === "number") {
      if (!Number.isFinite(rawNum)) {
        stats.nans++;
        pushBad(rowNumber, "nan", String(rawNum));
        continue;
      }
      num = rawNum;
    } else {
      const s = String(rawNum).trim();
      if (s === "") {
        stats.nulls++;
        pushBad(rowNumber, "null", "");
        continue;
      }
      const parsed = Number(s);
      if (!Number.isFinite(parsed)) {
        stats.nonNumeric++;
        pushBad(rowNumber, "nonNumeric", s);
        continue;
      }
      num = parsed;
    }

    // --- категориальная колонка ---
    if (rawCat == null) continue;
    const catStr = String(rawCat).trim();
    if (catStr === "") continue;

    tmpData[n] = num;
    tmpCatStrings[n] = catStr;
    n++;
    stats.valid++;
  }

  if (n === 0) return;

  const finalData = tmpData.slice(0, n);
  const catsList = tmpCatStrings.slice(0, n);

  // Уникальные категории.
  const catCounts = new Map<string, number>();
  for (const c of catsList) {
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }

  // Для ordinal-колонок порядок задаётся словарём шкалы
  // (Bronze → Silver → Gold → Platinum), а не частотой.
  // Для остальных — по частоте убыв., как раньше.
  const catColType = currentData.columnTypes[slotCat.columnIndex]?.type;
  let sortedCats: string[];
  if (catColType === "ordinal") {
    const ordered = orderOrdinalValues(Array.from(catCounts.keys()));
    sortedCats =
      ordered ??
      Array.from(catCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);
  } else {
    sortedCats = Array.from(catCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }

  const topN = card.settings.topN;
  const activeCats = topN > 0 ? sortedCats.slice(0, topN) : sortedCats;
  const activeIdx = new Map(
    activeCats.map((name, idx) => [name, idx] as const),
  );

  const finalCatIndices = new Int32Array(n);
  for (let i = 0; i < n; ++i) {
    const idx = activeIdx.get(catsList[i]);
    finalCatIndices[i] = idx === undefined ? -1 : idx;
  }

  if (activeCats.length === 0) return;

  const otherIdx = buckets.findIndex((b) => b.operator === "other");

  // --- ops, v1s, v2s из buckets ---
  const ops = new Int32Array(nB);
  const v1s = new Float64Array(nB);
  const v2s = new Float64Array(nB);
  for (let i = 0; i < nB; ++i) {
    const b = buckets[i];
    if (b.operator === "other") {
      ops[i] = -1;
      continue;
    }
    const valid =
      b.value1 != null && (b.operator !== "range" || b.value2 != null);
    if (!valid) {
      ops[i] = -1;
      continue;
    }
    ops[i] = opToCode(b.operator);
    v1s[i] = b.value1!;
    v2s[i] = b.operator === "range" ? b.value2! : 0;
  }

  // Canvas
  body.innerHTML = '<canvas class="viz-canvas-2d"></canvas>';
  const canvas = body.querySelector("canvas") as HTMLCanvasElement;
  const renderer = new GroupedHistogramRenderer(canvas);

  const resizeCanvas = () => {
    const r = body.getBoundingClientRect();
    renderer.resize(r.width - 16, r.height - 16);
  };
  resizeCanvas();

  const getXLabel = () =>
    card.settings.showAxisLabels ? slotNum.legendText.trim() : "";
  const getYLabel = () =>
    card.settings.showAxisLabels ? card.settings.yLabelOverride.trim() : "";

  const getBinLabels = (): string[] =>
    card.settings.buckets.map((b) =>
      getBucketLabel(b, card.settings.bucketsShowName),
    );

  // Имена серий нужны и для легенды, и для tooltip. Список всегда полный,
  // видимость легенды — через флаг `showLegend`.
  const getSeriesNames = (): string[] => activeCats;

  const redraw = () => {
    const run = runningGroupedHistograms.get(card.id);
    const state = run?.lastState ?? null;
    const names = getSeriesNames();

    // Если серий больше порога — inline-легенда отключается,
    // вместо неё показывается бейдж + модалка.
    const inlineLegend =
      card.settings.showLegend && names.length <= MAX_INLINE_LEGEND_ITEMS;

    renderer.draw(state, {
      xLabel: getXLabel(),
      yLabel: getYLabel(),
      showGrid: card.settings.showGrid,
      showAxisLabels: card.settings.showAxisLabels,
      showLegend: inlineLegend,
      precision: card.settings.precision,
      renderMode: card.settings.renderMode,
      seriesNames: names,
      binLabels: getBinLabels(),
      placeholder: "Готовим первую порцию…",
    });
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  observer.observe(body);

  // ---- Расчёт «other» в JS ----
  //
  // state.outOfBuckets в WASM не разбит по категориям, поэтому
  // "другое" считаем вручную: пробегаем по finalData, отбираем
  // значения, не попавшие ни в один валидный бакет, и раскладываем
  // их по категориям через finalCatIndices.
  const computeOtherCounts = (): number[] | null => {
    if (otherIdx < 0) return null;
    const counts = new Array<number>(activeCats.length).fill(0);

    for (let i = 0; i < finalData.length; i++) {
      const v = finalData[i];
      let matched = false;
      for (let bi = 0; bi < nB; bi++) {
        if (bi === otherIdx) continue;
        if (ops[bi] === -1) continue;
        const op = buckets[bi];
        if (matchesBucket(v, op)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        const ci = finalCatIndices[i];
        if (ci >= 0 && ci < counts.length) counts[ci]++;
      }
    }
    return counts;
  };

  // ---------- Значок ошибок ----------
  const errorsCount = stats.nulls + stats.nans + stats.nonNumeric;
  const issuesHandle = el ? createIssuesBadge(el, card.id) : null;
  issuesHandle?.update(errorsCount, 0);

  // ---------- Tooltip ----------
  const tooltip = document.createElement("div");
  tooltip.className = "viz-tooltip hidden";
  document.body.appendChild(tooltip);

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      tooltip.classList.add("hidden");
      return;
    }
    tooltip.innerHTML = `
      <div class="viz-tooltip-title">сегмент</div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">диапазон</span>
        <span class="viz-tooltip-value">${escapeHtml(hit.bucketLabel)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">серия</span>
        <span class="viz-tooltip-value">${escapeHtml(hit.seriesName)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">кол-во</span>
        <span class="viz-tooltip-value">${hit.value.toLocaleString("ru-RU")}</span>
      </div>
    `;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.remove("hidden");
  };

  const onLeave = () => tooltip.classList.add("hidden");

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  const run: GroupedHistogramRun = {
    handle: { cancel: () => {} },
    canvas,
    renderer,
    lastState: null,
    observer,
    getXLabel,
    getYLabel,
    getBinLabels,
    getSeriesNames,
    tooltip,
    onMove,
    onLeave,
    extractionStats: stats,
    issuesBadge: issuesHandle?.el ?? null,
    redraw,
  };
  runningGroupedHistograms.set(card.id, run);

  redraw();
  registerProgressRun(card.id, finalData.length);

  const handle = runProgressiveGroupedHistogram({
    data: finalData,
    catIndices: finalCatIndices,
    numCategories: activeCats.length,
    ops,
    v1s,
    v2s,
    numBuckets: nB,
    onProgress: (state) => {
      run.lastState = state;
      updateProgressRun(card.id, state.processed, state.total);
      issuesHandle?.update(errorsCount, state.outOfBuckets);
      legendBadges.get(card.id)?.update(activeCats.length);
      refreshLinkedLegends(card.id);
      redraw();
    },
    onDone: (rawState) => {
      let state = rawState;

      const otherCounts = computeOtherCounts();
      if (otherCounts && otherIdx >= 0) {
        const countsCopy = [...state.counts];
        for (let ci = 0; ci < otherCounts.length; ci++) {
          countsCopy[otherIdx * activeCats.length + ci] = otherCounts[ci];
        }
        state = { ...state, counts: countsCopy, outOfBuckets: 0 };
      }

      run.lastState = state;
      finishProgressRun(card.id);
      issuesHandle?.update(errorsCount, state.outOfBuckets);
      legendBadges.get(card.id)?.update(activeCats.length);
      refreshLinkedLegends(card.id);
      redraw();
    },
  });

  run.handle = handle;
}

function stopGroupedHistogramForCard(cardId: string) {
  const run = runningGroupedHistograms.get(cardId);
  if (!run) return;
  run.handle.cancel();
  run.observer.disconnect();
  run.canvas.removeEventListener("mousemove", run.onMove);
  run.canvas.removeEventListener("mouseleave", run.onLeave);
  run.tooltip.remove();
  if (run.issuesBadge) run.issuesBadge.remove();
  runningGroupedHistograms.delete(cardId);
  unregisterProgressRun(cardId);
}

function stopHistogramForCard(cardId: string) {
  const run = runningHistograms.get(cardId);
  if (!run) return;
  run.handle.cancel();
  run.observer.disconnect();
  run.canvas.removeEventListener("mousemove", run.onMove);
  run.canvas.removeEventListener("mouseleave", run.onLeave);
  run.tooltip.remove();
  if (run.issuesBadge) run.issuesBadge.remove();
  runningHistograms.delete(cardId);
  unregisterProgressRun(cardId);
}

// ---------- Модалка со списком исключённых строк ----------

interface OutOfBucketRow {
  rowNumber: number;
  value: number;
}

const MAX_OUT_OF_BUCKET_ROWS = 500;

/**
 * Проходит по исходным строкам, определяет значения, не попавшие
 * ни в одну группу, и возвращает счётчик и (ограниченный) список строк.
 */
function computeOutOfBucketsRows(card: VizCard): {
  count: number;
  rows: OutOfBucketRow[];
} {
  if (!currentData) return { count: 0, rows: [] };

  const isGrouped =
    card.vizId === "histogram-grouped" || card.vizId === "barchart-grouped";
  if (
    card.vizId !== "histogram-buckets" &&
    card.vizId !== "barchart-buckets" &&
    !isGrouped
  ) {
    return { count: 0, rows: [] };
  }

  // Если в настройках есть бакет "other" — он забирает все
  // out-of-bucket строки себе, значит warnings-строк нет.
  if (card.settings.buckets.some((b) => b.operator === "other")) {
    return { count: 0, rows: [] };
  }

  const slot = card.settings.slots[0];
  if (!slot) return { count: 0, rows: [] };

  // Для grouped-гистограммы нужно также проверять валидность
  // категориальной колонки: в WASM-ядре такие строки не считаются
  // «out of buckets» — они вообще пропускаются.
  const catSlot = isGrouped ? card.settings.slots[1] : null;
  if (isGrouped && !catSlot) return { count: 0, rows: [] };
  const catColIdx = catSlot?.columnIndex ?? -1;

  const buckets = card.settings.buckets;
  if (buckets.length === 0) return { count: 0, rows: [] };

  const colIdx = slot.columnIndex;
  const rows = currentData.rows;

  let count = 0;
  const outRows: OutOfBucketRow[] = [];

  for (let i = 0; i < rows.length; ++i) {
    // Для grouped — сначала проверяем категориальную колонку.
    if (isGrouped) {
      const cv = rows[i][catColIdx];
      if (cv == null) continue;
      const cs = String(cv).trim();
      if (cs === "") continue;
    }

    const v = rows[i][colIdx];
    if (v == null) continue;
    const num = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(num)) continue;

    let matched = false;
    for (const b of buckets) {
      if (matchesBucket(num, b)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      count++;
      if (outRows.length < MAX_OUT_OF_BUCKET_ROWS) {
        outRows.push({ rowNumber: i + 1, value: num });
      }
    }
  }

  return { count, rows: outRows };
}

function setActiveBadRowsTab(tab: "errors" | "warnings") {
  badRowsModal
    .querySelectorAll<HTMLButtonElement>(".bad-rows-tab")
    .forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
    });
  badRowsModal
    .querySelectorAll<HTMLElement>("[data-tab-content]")
    .forEach((el) => {
      el.classList.toggle(
        "hidden",
        el.getAttribute("data-tab-content") !== tab,
      );
    });
}

badRowsModal
  .querySelectorAll<HTMLButtonElement>(".bad-rows-tab")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab === "errors" || tab === "warnings") {
        setActiveBadRowsTab(tab);
      }
    });
  });

badRowsCancel.addEventListener("click", closeBadRowsModal);

function openBadRowsModal(cardId: string) {
  const groupedBar = runningGroupedBars.get(cardId);
  const grouped = runningGroupedHistograms.get(cardId);
  const bucketedBar = runningBucketedBars.get(cardId);
  const bucketed = runningBucketedHistograms.get(cardId);
  const hist = runningHistograms.get(cardId);
  const bar = runningBars.get(cardId);
  const boxPlot = runningBoxPlots.get(cardId);
  const stats =
    groupedBar?.extractionStats ??
    grouped?.extractionStats ??
    bucketedBar?.extractionStats ??
    bucketed?.extractionStats ??
    hist?.extractionStats ??
    bar?.extractionStats ??
    boxPlot?.extractionStats;
  if (!stats) return;

  const card = vizCards.find((c) => c.id === cardId);
  if (!card) return;

  const totalErrors = stats.nulls + stats.nans + stats.nonNumeric;

  // Out-of-buckets считаем лениво для всех bucketed-визуализаций,
  // включая grouped histogram.
  const outInfo =
    card.vizId === "histogram-buckets" ||
    card.vizId === "barchart-buckets" ||
    card.vizId === "histogram-grouped" ||
    card.vizId === "barchart-grouped"
      ? computeOutOfBucketsRows(card)
      : { count: 0, rows: [] as OutOfBucketRow[] };

  if (totalErrors === 0 && outInfo.count === 0) return;

  // ---- Счётчики в табах ----
  badRowsErrorsCount.textContent = String(totalErrors);
  badRowsWarningsCount.textContent = String(outInfo.count);

  // ---- Таб «Ошибки» ----
  const reasonLabel: Record<BadRow["reason"], string> = {
    null: "пусто",
    nan: "NaN / Inf",
    nonNumeric: "не число",
  };
  const renderLimit = 500;

  if (totalErrors === 0) {
    badRowsErrorsTbody.innerHTML = `<tr><td colspan="3" class="bad-rows-more">Ошибок нет</td></tr>`;
  } else {
    const shown = stats.badRows.slice(0, renderLimit);
    badRowsErrorsTbody.innerHTML = shown
      .map(
        (b) => `
        <tr>
          <td>${b.rowNumber.toLocaleString("ru-RU")}</td>
          <td>${b.rawValue ? escapeHtml(b.rawValue) : "<пусто>"}</td>
          <td><span class="bad-rows-reason ${b.reason}">${reasonLabel[b.reason]}</span></td>
        </tr>
      `,
      )
      .join("");

    if (totalErrors > renderLimit) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="3" class="bad-rows-more">Показано ${renderLimit.toLocaleString("ru-RU")} из ${totalErrors.toLocaleString("ru-RU")}</td>`;
      badRowsErrorsTbody.appendChild(row);
    }
  }

  // ---- Таб «Предупреждения» ----
  if (outInfo.count === 0) {
    badRowsWarningsTbody.innerHTML = `<tr><td colspan="3" class="bad-rows-more">Предупреждений нет</td></tr>`;
  } else {
    badRowsWarningsTbody.innerHTML = outInfo.rows
      .map(
        (r) => `
        <tr>
          <td>${r.rowNumber.toLocaleString("ru-RU")}</td>
          <td>${escapeHtml(formatNumberRu(r.value))}</td>
          <td><span class="bad-rows-reason warn">не попало ни в один диапазон</span></td>
        </tr>
      `,
      )
      .join("");

    if (outInfo.count > outInfo.rows.length) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="3" class="bad-rows-more">Показано ${outInfo.rows.length.toLocaleString("ru-RU")} из ${outInfo.count.toLocaleString("ru-RU")}</td>`;
      badRowsWarningsTbody.appendChild(row);
    }
  }

  // ---- Активный таб по умолчанию ----
  setActiveBadRowsTab(totalErrors > 0 ? "errors" : "warnings");

  // ---- Открыть модалку ----
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth;
  document.body.style.setProperty("--scrollbar-width", `${scrollbarWidth}px`);
  document.body.classList.add("modal-open");
  badRowsModal.classList.add("open");
}

function closeBadRowsModal() {
  badRowsModal.classList.remove("open");
  document.body.classList.remove("modal-open");
}

// ------------------------------------------------------------
// МОДАЛКА РАСШИРЕННОЙ ЛЕГЕНДЫ
// ------------------------------------------------------------

interface LegendRow {
  color: string;
  name: string;
  count: number;
  share: number;
}

/**
 * Открывает существующую карточку-легенду для указанной диаграммы
 * или создаёт новую, если её ещё нет.
 */
function openOrFocusLegendCard(sourceCardId: string): void {
  const sourceCard = vizCards.find((c) => c.id === sourceCardId);
  if (!sourceCard) return;

  const existing = vizCards.find(
    (c) => c.vizId === "legend" && c.linkedCardId === sourceCardId,
  );
  if (existing) {
    setActiveCard(existing.id);
    return;
  }

  createLegendCard(sourceCard);
}

function createLegendCard(sourceCard: VizCard): VizCard {
  const id = `viz-card-${++cardCounter}`;
  const width = 320;
  const height = 380;
  const pos = findPlacement(width, height);

  const card: VizCard = {
    id,
    vizId: "legend",
    x: pos.x,
    y: pos.y,
    width,
    height,
    linkedCardId: sourceCard.id,
    settings: {
      title: `Легенда · ${sourceCard.settings.title}`,
      showLegend: false,
      showAxisLabels: false,
      legendText: "",
      slots: [null, null],
      bins: 30,
      yLabelOverride: "",
      topN: 0,
      showGrid: false,
      precision: 0,
      buckets: [],
      bucketsShowName: false,
      renderMode: "grouped",
    },
  };

  vizCards.push(card);
  createCardElement(card);
  vizEmptyState.style.display = "none";
  setActiveCard(card.id);
  scheduleSaveVizState();
  return card;
}

/**
 * Отрисовывает содержимое карточки-легенды: заголовок с Σ, таблицу серий.
 * Вызывается при создании карточки и при обновлениях исходной диаграммы.
 */
function renderLegendCardBody(card: VizCard): void {
  if (card.vizId !== "legend") return;
  const el = document.getElementById(card.id);
  if (!el) return;
  const body = el.querySelector<HTMLElement>(".legend-card-body");
  if (!body) return;

  const sourceCard = card.linkedCardId
    ? vizCards.find((c) => c.id === card.linkedCardId)
    : null;

  if (!sourceCard) {
    body.innerHTML = `<p class="legend-empty">Исходная диаграмма удалена.</p>`;
    return;
  }

  const rows = collectLegendRows(sourceCard);
  if (rows.length === 0) {
    body.innerHTML = `<p class="legend-empty">Нет данных для отображения.</p>`;
    return;
  }

  const total = rows.reduce((s, r) => s + r.count, 0);

  body.innerHTML = `
    <div class="legend-card-summary">
      <span class="legend-card-summary-label">Серий:</span>
      <span class="legend-card-summary-value">${rows.length}</span>
      <span class="legend-card-summary-sep">·</span>
      <span class="legend-card-summary-label">Σ</span>
      <span class="legend-card-summary-value">${total.toLocaleString("ru-RU")}</span>
    </div>
    <div class="legend-card-table-wrap">
      <table class="legend-table">
        <thead>
          <tr>
            <th style="width: 26px"></th>
            <th>Серия</th>
            <th style="text-align: right">Кол-во</th>
            <th style="text-align: right">Доля</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td><span class="legend-swatch" style="background:${r.color}"></span></td>
              <td class="legend-name">${escapeHtml(r.name)}</td>
              <td class="legend-count">${r.count.toLocaleString("ru-RU")}</td>
              <td class="legend-share">${(r.share * 100).toFixed(1)}%</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Перерисовывает все карточки-легенды, привязанные к указанной диаграмме.
 * Вызывается из onProgress/onDone диаграммы, когда данные обновились.
 */
function refreshLinkedLegends(sourceCardId: string): void {
  for (const lc of vizCards) {
    if (lc.vizId === "legend" && lc.linkedCardId === sourceCardId) {
      renderLegendCardBody(lc);
    }
  }
}

/**
 * Собирает строки легенды из последнего состояния run-объекта:
 * имя серии, общее количество, доля, цвет из палитры рендерера.
 */
function collectLegendRows(card: VizCard): LegendRow[] {
  const groupedHist = runningGroupedHistograms.get(card.id);
  const groupedBar = runningGroupedBars.get(card.id);

  const state = groupedHist?.lastState ?? groupedBar?.lastState ?? null;
  const seriesNames =
    groupedHist?.getSeriesNames() ?? groupedBar?.getSeriesNames() ?? [];

  if (!state || seriesNames.length === 0) return [];

  const nCats = state.numCategories;
  const nB = state.numBuckets;

  // Сумма по каждому столбцу (каждая категория)
  const totals = new Array<number>(nCats).fill(0);
  for (let b = 0; b < nB; b++) {
    for (let c = 0; c < nCats; c++) {
      totals[c] += state.counts[b * nCats + c];
    }
  }

  const grandTotal = totals.reduce((s, v) => s + v, 0);

  const PALETTE = [
    "#4a9eff",
    "#f59e0b",
    "#10b981",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
    "#f97316",
  ];

  return seriesNames.map((name, i) => ({
    color: PALETTE[i % PALETTE.length],
    name,
    count: totals[i] ?? 0,
    share: grandTotal > 0 ? (totals[i] ?? 0) / grandTotal : 0,
  }));
}

// Esc закрывает модалку
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && badRowsModal.classList.contains("open")) {
    closeBadRowsModal();
  }
});

// ============================================================
// ЛИНЕЙЧАТАЯ ДИАГРАММА — ИНТЕГРАЦИЯ
// ============================================================

interface BarChartRun {
  handle: BarChartHandle;
  canvas: HTMLCanvasElement;
  renderer: BarChartRenderer;
  observer: ResizeObserver;
  lastData: BarChartData | null;
  lastValues: number[] | null;
  /** Сколько обработано на текущий момент (обновляется из onProgress). */
  processed: number;
  /** Сколько всего значений. */
  total: number;
  getXLabel: () => string;
  getYLabel: () => string;
  tooltip: HTMLDivElement;
  onMove: (e: MouseEvent) => void;
  onLeave: () => void;
  extractionStats: ExtractionStats;
  issuesBadge: HTMLElement | null;
  /** Перерисовка с текущими настройками. */
  redraw: () => void;
}

// ============================================================
// BOX PLOT — ИНТЕГРАЦИЯ
// ============================================================

interface BoxPlotRun {
  handle: BoxPlotHandle;
  canvas: HTMLCanvasElement;
  renderer: BoxPlotRenderer;
  lastState: BoxPlotChunkResult | null;
  observer: ResizeObserver;
  getXLabel: () => string;
  getYLabel: () => string;
  tooltip: HTMLDivElement;
  onMove: (e: MouseEvent) => void;
  onLeave: () => void;
  extractionStats: ExtractionStats;
  issuesBadge: HTMLElement | null;
  redraw: () => void;
}

const runningBoxPlots = new Map<string, BoxPlotRun>();

function runBoxPlotForCard(card: VizCard) {
  stopBoxPlotForCard(card.id);

  if (!currentData) return;
  const slot = card.settings.slots[0];
  if (!slot) return;

  const t0 = performance.now();
  const { values: data, stats } = extractNumericColumn(
    currentData,
    slot.columnIndex,
  );

  if (data.length < 5) {
    console.warn(
      `[Box plot ${card.id}] нужно минимум 5 значений в колонке «${slot.name}»`,
    );
    return;
  }

  const el = document.getElementById(card.id);
  const body = el?.querySelector(".viz-card-body") as HTMLElement | null;
  if (!body) return;

  body.innerHTML = '<canvas class="viz-canvas-2d"></canvas>';
  const canvas = body.querySelector("canvas") as HTMLCanvasElement;
  const renderer = new BoxPlotRenderer(canvas);

  const resizeCanvas = () => {
    const r = body.getBoundingClientRect();
    renderer.resize(r.width - 16, r.height - 16);
  };
  resizeCanvas();

  // По логике renderSettingsContent для box plot (ветка «не-histogram»):
  //   «Подпись оси X (частота)»  → yLabelOverride
  //   «Подпись оси Y (значения)» → slot.legendText
  const getXLabel = () => {
    if (!card.settings.showAxisLabels) return "";
    return card.settings.yLabelOverride.trim();
  };
    const getYLabel = () => {
    if (!card.settings.showAxisLabels) return "";
    return (slot.legendText ?? "").trim();
  };
  const getLegendText = () => {
    if (!card.settings.showLegend) return "";
    return card.settings.legendText.trim() || slot.name;
  };

  const redraw = () => {
    const run = runningBoxPlots.get(card.id);
    const state = run?.lastState ?? null;

    renderer.draw(state, {
      xLabel: getXLabel(),
      yLabel: getYLabel(),
      legendText: getLegendText(),
      showGrid: card.settings.showGrid,
      showAxisLabels: card.settings.showAxisLabels,
      precision: card.settings.precision,
      processed: state?.processed,
      total: state?.total,
      placeholder: "Готовим первую порцию…",
    });
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  observer.observe(body);

  // ---------- Tooltip ----------
  const tooltip = document.createElement("div");
  tooltip.className = "viz-tooltip hidden";
  document.body.appendChild(tooltip);

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    if (!hit) {
      tooltip.classList.add("hidden");
      return;
    }
    const p = card.settings.precision;
    const st = runningBoxPlots.get(card.id)?.lastState;
    const upOut = st?.upperOutlierCount ?? 0;
    const loOut = st?.lowerOutlierCount ?? 0;
    const totalOut = upOut + loOut;

    tooltip.innerHTML = `
      <div class="viz-tooltip-title">box plot</div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">max</span>
        <span class="viz-tooltip-value">${formatNumberPrecise(hit.max, p)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">Q3</span>
        <span class="viz-tooltip-value">${formatNumberPrecise(hit.q3, p)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">median</span>
        <span class="viz-tooltip-value">${formatNumberPrecise(hit.median, p)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">Q1</span>
        <span class="viz-tooltip-value">${formatNumberPrecise(hit.q1, p)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">min</span>
        <span class="viz-tooltip-value">${formatNumberPrecise(hit.min, p)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">IQR</span>
        <span class="viz-tooltip-value">${formatNumberPrecise(hit.iqr, p)}</span>
      </div>
      ${totalOut > 0 ? `
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">выбросов</span>
        <span class="viz-tooltip-value">${totalOut.toLocaleString("ru-RU")}</span>
      </div>
      ` : ""}
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">n</span>
        <span class="viz-tooltip-value">${hit.count.toLocaleString("ru-RU")}</span>
      </div>
    `;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.remove("hidden");
  };

  const onLeave = () => tooltip.classList.add("hidden");

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  const errorsCount = stats.nulls + stats.nans + stats.nonNumeric;
  const issuesHandle = el ? createIssuesBadge(el, card.id) : null;
  issuesHandle?.update(errorsCount, 0);
  const issuesBadge: HTMLElement | null = issuesHandle?.el ?? null;

  const run: BoxPlotRun = {
    handle: { cancel: () => {} },
    canvas,
    renderer,
    lastState: null,
    observer,
    getXLabel,
    getYLabel,
    tooltip,
    onMove,
    onLeave,
    extractionStats: stats,
    issuesBadge,
    redraw,
  };
  runningBoxPlots.set(card.id, run);

  redraw();
  registerProgressRun(card.id, data.length);

  const handle = runProgressiveBoxPlot({
    data,
    onProgress: (state) => {
      run.lastState = state;
      updateProgressRun(card.id, state.processed, state.total);
      redraw();
    },
    onDone: (state) => {
      run.lastState = state;
      finishProgressRun(card.id);
      redraw();

      const elapsed = Math.round(performance.now() - t0);
      console.group(
        `%c[Box plot ${card.id}] готово за ${elapsed} мс`,
        "color:#16a34a;font-weight:bold",
      );
      console.log(`Обработано: ${state.total.toLocaleString("ru-RU")}`);
      console.log(
        `Q1=${state.q1.toFixed(2)} median=${state.median.toFixed(2)} Q3=${state.q3.toFixed(2)}`,
      );
      console.groupEnd();
    },
  });

  run.handle = handle;
}

function stopBoxPlotForCard(cardId: string) {
  const run = runningBoxPlots.get(cardId);
  if (!run) return;
  run.handle.cancel();
  run.observer.disconnect();
  run.canvas.removeEventListener("mousemove", run.onMove);
  run.canvas.removeEventListener("mouseleave", run.onLeave);
  run.tooltip.remove();
  if (run.issuesBadge) run.issuesBadge.remove();
  runningBoxPlots.delete(cardId);
  unregisterProgressRun(cardId);
}

const runningBars = new Map<string, BarChartRun>();

function runBarChartForCard(card: VizCard) {
  stopBarChartForCard(card.id);

  if (!currentData) return;
  const slot = card.settings.slots[0];
  if (!slot) return;

  const t0 = performance.now();
  const { values: nums, stats } = extractNumericColumn(
    currentData,
    slot.columnIndex,
  );

  if (nums.length === 0) {
    console.warn(
      `[Bar chart ${card.id}] нет числовых значений в колонке «${slot.name}»`,
    );
    return;
  }

  // ---- Диапазон ----
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < nums.length; ++i) {
    const v = nums[i];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (!isFinite(minV) || !isFinite(maxV)) return;
  if (maxV <= minV) maxV = minV + 1;

  // ---- Бины ----
  const bins = Math.max(1, card.settings.bins);
  const binWidth = (maxV - minV) / bins;

  const catIndices = new Int32Array(nums.length);
  for (let i = 0; i < nums.length; ++i) {
    let b = Math.floor((nums[i] - minV) / binWidth);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    catIndices[i] = b;
  }

  console.group(
    `%c[Bar chart ${card.id}] колонка «${slot.name}»`,
    "color:#4a9eff;font-weight:bold",
  );
  console.log(`Числовых значений: ${stats.valid.toLocaleString("ru-RU")}`);
  console.log(`Диапазон: [${formatNumberRu(minV)} … ${formatNumberRu(maxV)}]`);
  console.log(`Бинов: ${bins}`);
  if (card.settings.topN > 0) console.log(`Топ-N: ${card.settings.topN}`);
  console.groupEnd();

  // ---- Canvas ----
  const el = document.getElementById(card.id);
  const body = el?.querySelector(".viz-card-body") as HTMLElement | null;
  if (!body) return;

  body.innerHTML = '<canvas class="viz-canvas-2d"></canvas>';
  const canvas = body.querySelector("canvas") as HTMLCanvasElement;
  const renderer = new BarChartRenderer(canvas);

  const resizeCanvas = () => {
    const r = body.getBoundingClientRect();
    renderer.resize(r.width - 16, r.height - 16);
  };
  resizeCanvas();

  const getXLabel = () => {
    // Ось X — частоты. Подпись хранится в yLabelOverride.
    if (!card.settings.showAxisLabels) return "";
    return card.settings.yLabelOverride.trim();
  };
  const getYLabel = () => {
    // Ось Y — категории (диапазоны). Подпись = legendText слота.
    if (!card.settings.showAxisLabels) return "";
    return (slot.legendText || slot.name).trim();
  };
  const getLegendText = () => {
    if (!card.settings.showLegend) return "";
    return card.settings.legendText.trim() || slot.name;
  };

  /**
   * Пересобирает BarChartData из сырых values.
   * Метки категорий формируются здесь, поэтому всегда
   * используют актуальную точность (card.settings.precision).
   */
  const applyTopN = (valuesArr: number[]): BarChartData => {
    const prec = card.settings.precision;

    // Метки диапазонов — формируем на каждом вызове
    const labels: string[] = [];
    for (let i = 0; i < bins; ++i) {
      const lo = minV + i * binWidth;
      const hi = lo + binWidth;
      labels.push(
        `${formatNumberPrecise(lo, prec)}–${formatNumberPrecise(hi, prec)}`,
      );
    }

    const topN = card.settings.topN;

    if (topN <= 0 || topN >= bins) {
      const cats: BarChartCategory[] = [];
      for (let i = 0; i < bins; ++i) {
        cats.push({ label: labels[i], value: valuesArr[i] });
      }
      return { categories: cats, metricLabel: "Частота" };
    }

    const indexed = valuesArr.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => b.v - a.v);
    const topSet = new Set(indexed.slice(0, topN).map((x) => x.i));
    const keptIdx = Array.from(topSet).sort((a, b) => a - b);

    const cats: BarChartCategory[] = [];
    for (const i of keptIdx) {
      cats.push({ label: labels[i], value: valuesArr[i] });
    }
    return { categories: cats, metricLabel: "Частота" };
  };

  const redraw = () => {
    const run = runningBars.get(card.id);
    if (!run) return;

    const values = run.lastValues ?? new Array(bins).fill(0);
    const data = applyTopN(values);
    run.lastData = data;

    renderer.draw(data, {
      xLabel: getXLabel(),
      yLabel: getYLabel(),
      legendText: getLegendText(),
      showGrid: card.settings.showGrid,
      showAxisLabels: card.settings.showAxisLabels,
      preserveOrder: true,
      precision: card.settings.precision,
      processed: run.processed,
      total: run.total,
    });
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  observer.observe(body);

  // ---------- Tooltip ----------
  const tooltip = document.createElement("div");
  tooltip.className = "viz-tooltip hidden";
  document.body.appendChild(tooltip);

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      tooltip.classList.add("hidden");
      return;
    }
    tooltip.innerHTML = `
      <div class="viz-tooltip-title">диапазон</div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">значения</span>
        <span class="viz-tooltip-value">${escapeHtml(hit.label)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">кол-во</span>
        <span class="viz-tooltip-value">${formatNumberRu(hit.value)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">доля</span>
        <span class="viz-tooltip-value">${(hit.percentage * 100).toFixed(2)}%</span>
      </div>
    `;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.remove("hidden");
  };

  const onLeave = () => tooltip.classList.add("hidden");

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  // ---------- Значок bad rows ----------
  const errorsCount = stats.nulls + stats.nans + stats.nonNumeric;
  const issuesHandle = el ? createIssuesBadge(el, card.id) : null;
  issuesHandle?.update(errorsCount, 0);
  const issuesBadge: HTMLElement | null = issuesHandle?.el ?? null;

  const run: BarChartRun = {
    handle: { cancel: () => {} },
    canvas,
    renderer,
    observer,
    lastData: null,
    lastValues: null,
    processed: 0,
    total: nums.length,
    getXLabel,
    getYLabel,
    tooltip,
    onMove,
    onLeave,
    extractionStats: stats,
    issuesBadge,
    redraw,
  };
  runningBars.set(card.id, run);

  redraw();
  registerProgressRun(card.id, nums.length);

  const handle = runProgressiveBarChart({
    catIndices,
    values: null,
    numCategories: bins,
    onProgress: (state) => {
      run.lastValues = state.values;
      run.processed = state.processed;
      run.total = state.total;
      updateProgressRun(card.id, state.processed, state.total);
      redraw();
    },
    onDone: (state) => {
      run.lastValues = state.values;
      run.processed = state.processed;
      run.total = state.total;
      finishProgressRun(card.id);
      redraw();

      const sum = state.values.reduce((a, b) => a + b, 0);
      const elapsed = Math.round(performance.now() - t0);
      console.group(
        `%c[Bar chart ${card.id}] готово за ${elapsed} мс`,
        "color:#16a34a;font-weight:bold",
      );
      console.log(`Обработано: ${state.total.toLocaleString("ru-RU")}`);
      console.log(`Сумма частот: ${sum.toLocaleString("ru-RU")}`);
      console.log(`Бинов всего: ${state.categories}`);
      if (card.settings.topN > 0)
        console.log(`Показано топ-${card.settings.topN}`);
      console.groupEnd();
    },
  });

  run.handle = handle;
}

function stopBarChartForCard(cardId: string) {
  const run = runningBars.get(cardId);
  if (!run) return;
  run.handle.cancel();
  run.observer.disconnect();
  run.canvas.removeEventListener("mousemove", run.onMove);
  run.canvas.removeEventListener("mouseleave", run.onLeave);
  run.tooltip.remove();
  if (run.issuesBadge) run.issuesBadge.remove();
  runningBars.delete(cardId);
  unregisterProgressRun(cardId);
}

// ============================================================
// СВОРАЧИВАНИЕ ПАНЕЛЕЙ
// ============================================================

document.querySelectorAll(".panel-collapse-btn").forEach((btn) => {
  if (btn.id === "settings-close-btn") return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const panelId = btn.getAttribute("data-panel");
    if (!panelId) return;

    const panel = document.getElementById(panelId);
    if (!panel) return;

    panel.classList.toggle("collapsed");
    const isCollapsed = panel.classList.contains("collapsed");
    btn.setAttribute("title", isCollapsed ? "Развернуть" : "Свернуть");
  });
});

// ============================================================
// ГЛОБАЛЬНЫЙ ПЕРЕХВАТ DRAG'А
// ============================================================
//
// Нативный HTML5 drag нужен только элементам списка колонок
// (для переноса в drop-зоны настроек). Всё остальное — тулбар,
// прогресс-бары, карточки, панели — должно игнорировать drag.
//
// CSS уже делает это через -webkit-user-drag: none, но добавляем
// JS-страховку: на случай платформ, где CSS не срабатывает
// (старые браузеры, WebKit-вариации) — принудительно отменяем
// dragstart для всех элементов, кроме колонок.

document.addEventListener(
  "dragstart",
  (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Разрешаем drag только для элементов списка колонок
    if (target.closest('.columns-list li[draggable="true"]')) return;

    e.preventDefault();
  },
  true, // capture-фаза: срабатывает раньше любых пользовательских
  // обработчиков, поэтому никакой drag из тулбара/карточек
  // уже не проскочит
);

// ============================================================
// СТАРТ
// ============================================================

restoreSession();

// Сохраняем состояние визуализаций при закрытии вкладки.
// IndexedDB-операции могут не успеть завершиться, но дебаунс обычно
// уже сохранил всё заранее — это лишь подстраховка.
window.addEventListener("beforeunload", () => {
  if (saveVizTimer !== null) {
    window.clearTimeout(saveVizTimer);
    saveVizTimer = null;
  }
  void persistVizState();
});
