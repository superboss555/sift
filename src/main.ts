import "./styles.css";

import { loadFile, type ParsedData } from "./lib/loader.js";
import { collectMemoryStats, formatBytes } from "./lib/memory.js";
import {
  saveSession,
  loadSession,
  clearSession,
  sessionToFile,
} from "./lib/storage.js";

import {
  runProgressiveHistogram,
  type HistogramHandle,
  type HistogramChunkResult,
} from "./lib/sift-core.js";
import { HistogramRenderer } from "./lib/renderers/histogram-renderer.js";
import {
  BarChartRenderer,
  type BarChartCategory,
  type BarChartData,
} from "./lib/renderers/barchart-renderer.js";

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
const vizOptionsList = document.getElementById(
  "viz-options-list",
) as HTMLUListElement;

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
const badRowsText = document.getElementById(
  "bad-rows-text",
) as HTMLParagraphElement;
const badRowsTbody = document.getElementById(
  "bad-rows-tbody",
) as HTMLTableSectionElement;
const badRowsCancel = document.getElementById(
  "bad-rows-cancel",
) as HTMLButtonElement;

// ============================================================
// СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ============================================================

let currentData: ParsedData | null = null;
let currentFileName = "";
let selectedColumnIndex: number | null = null;
let vizScreenInitialized = false;

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
    // Первый переход на страницу 2 в этой сессии — сбрасываем состояние
    resetVizOptions();
    vizScreenInitialized = true;
  } else {
    // Уже были здесь — карточки на месте, только обновим доступность колонок
    updateColumnsAvailability();
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
});

// ============================================================
// СПИСОК КОЛОНОК
// ============================================================

function renderColumnsList() {
  if (!currentData) return;

  columnsList.innerHTML = currentData.columnTypes
    .map(
      (ct, idx) => `
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
  });

  updateColumnsAvailability();
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

const VIZ_OPTIONS = [
  {
    id: "histogram",
    label: "Гистограмма",
    types: ["numeric"],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="20" x2="4" y2="14"/>
            <line x1="9" y1="20" x2="9" y2="8"/>
            <line x1="14" y1="20" x2="14" y2="4"/>
            <line x1="19" y1="20" x2="19" y2="12"/>
            <line x1="2" y1="21" x2="22" y2="21"/>
        </svg>`,
  },
  {
    id: "barchart",
    label: "Линейчатая диаграмма",
    types: ["string", "mixed"],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="6" x2="14" y2="6"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="10" y2="18"/>
        </svg>`,
  },
  {
    id: "boxplot",
    label: "Box plot",
    types: ["numeric"],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="3" x2="12" y2="7"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <rect x="7" y="7" width="10" height="10" rx="1"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>`,
  },
  {
    id: "piechart",
    label: "Круговая диаграмма",
    types: ["string", "mixed"],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>
            <path d="M22 12A10 10 0 0 0 12 2v10z"/>
        </svg>`,
  },
  {
    id: "summary",
    label: "Сводка (среднее, медиана, ст. откл.)",
    types: ["numeric"],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>`,
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

interface CardSettings {
  title: string;
  showLegend: boolean;
  slots: [DataSlot | null, DataSlot | null];
  bins: number;
  yLabelOverride: string;
  topN: number;
  showGrid: boolean;
  showAxisLabels: boolean;
}

// ============================================================
// ДИНАМИЧЕСКИЙ РЕНДЕР ТЕЛА КАРТОЧКИ (SVG-заглушки)
// ============================================================

const DEFAULT_AXIS_LABELS: Record<string, [string, string]> = {
  histogram: ["Значения", "Частота"],
  barchart: ["", ""],
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
    const yLabel = getAxisLabel(slot0, "Категории", showLegend);
    const xLabel = slot1
      ? getAxisLabel(slot1, "Значения", showLegend)
      : showLegend
        ? card.settings.yLabelOverride.trim() || "Количество записей"
        : "";
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
// СОХРАНЕНИЕ И ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ ВИЗУАЛИЗАЦИЙ
// ============================================================

function collectVizState(): VizState | null {
  if (!currentFileName) return null;
  return {
    fileName: currentFileName,
    savedAt: Date.now(),
    cards: vizCards.map((c) => ({
      id: c.id,
      vizId: c.vizId,
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      settings: {
        title: c.settings.title,
        showLegend: c.settings.showLegend,
        slots: [
          c.settings.slots[0] ? { ...c.settings.slots[0] } : null,
          c.settings.slots[1] ? { ...c.settings.slots[1] } : null,
        ],
        bins: c.settings.bins,
        yLabelOverride: c.settings.yLabelOverride,
        topN: c.settings.topN,
        showGrid: c.settings.showGrid,
        showAxisLabels: c.settings.showAxisLabels,
      },
    })),
    activeCardId,
    cardCounter,
  };
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
  // Чистим всё текущее
  for (const id of [...runningHistograms.keys()]) stopHistogramForCard(id);
  for (const id of [...runningBars.keys()]) stopBarChartForCard(id);
  vizCards = [];
  activeCardId = null;
  vizCanvas.querySelectorAll(".viz-card").forEach((el) => el.remove());
  clearGuides();
  vizEmptyState.style.display = "";

  // Восстанавливаем счётчик id
  cardCounter = state.cardCounter || 0;
  for (const sc of state.cards) {
    const m = sc.id.match(/^viz-card-(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > cardCounter) cardCounter = n;
    }
  }

  // Восстанавливаем карточки
  for (const sc of state.cards) {
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
      // Обновляем имя колонки на актуальное
      fixedSlots[i] = {
        columnIndex: slot.columnIndex,
        name: ct.name,
        legendText: slot.legendText,
      };
    }

    const card: VizCard = {
      id: sc.id,
      vizId: sc.vizId,
      x: sc.x,
      y: sc.y,
      width: sc.width,
      height: sc.height,
      settings: {
        title: sc.settings.title,
        showLegend: sc.settings.showLegend,
        slots: fixedSlots,
        bins: sc.settings.bins,
        yLabelOverride: sc.settings.yLabelOverride,
        topN: sc.settings.topN,
        showGrid: sc.settings.showGrid ?? true,
        showAxisLabels: sc.settings.showAxisLabels ?? true,
      },
    };
    vizCards.push(card);
    createCardElement(card);
    vizEmptyState.style.display = "none";
    syncCardVisual(card);
  }

  // Восстанавливаем активную карточку
  if (state.activeCardId && vizCards.some((c) => c.id === state.activeCardId)) {
    setActiveCard(state.activeCardId);
  }
}

// ============================================================
// СИСТЕМА КАРТОЧЕК В РАБОЧЕМ ПРОСТРАНСТВЕ
// ============================================================

interface VizCard {
  id: string;
  vizId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  settings: CardSettings;
}

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

let vizCards: VizCard[] = [];
let activeCardId: string | null = null;
let cardCounter = 0;

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

function addVizCard(vizId: string): VizCard | null {
  const viz = VIZ_OPTIONS.find((v) => v.id === vizId);
  if (!viz) return null;

  const id = `viz-card-${++cardCounter}`;
  const size = getDefaultSize(vizId);
  const pos = findPlacement(size.width, size.height);

  const card: VizCard = {
    id,
    vizId,
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    settings: {
      title: viz.label,
      showLegend: false,
      slots: [null, null],
      bins: 30,
      yLabelOverride: vizId === "histogram" ? "Частота" : "",
      topN: 0,
      showGrid: true,
      showAxisLabels: true,
    },
  };

  vizCards.push(card);
  createCardElement(card);
  vizEmptyState.style.display = "none";

  scheduleSaveVizState();

  return card;
}

function createCardElement(card: VizCard) {
  const viz = VIZ_OPTIONS.find((v) => v.id === card.vizId);
  if (!viz) return;

  const el = document.createElement("div");
  el.className = "viz-card";
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
        <div class="viz-card-body">
            ${buildVizSVG(card)}
        </div>
        <div class="viz-card-resize" title="Изменить размер"></div>
    `;

  vizCanvas.appendChild(el);

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
      target.closest(".viz-card-issues-badge")
    ) {
      return;
    }
    openSettingsPanel();
  });

  makeDraggable(el, card);
  makeResizable(el, card);
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
  stopHistogramForCard(cardId);
  stopBarChartForCard(cardId);

  vizCards = vizCards.filter((c) => c.id !== cardId);
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

// ---------- Реакция на изменение размеров поля ----------

const canvasResizeObserver = new ResizeObserver(() => {
  const boundsW = vizCanvas.clientWidth;
  const boundsH = vizCanvas.clientHeight;

  vizCards.forEach((card) => {
    const el = document.getElementById(card.id);
    if (!el) return;

    let changed = false;
    if (card.x + card.width > boundsW) {
      card.x = Math.max(0, boundsW - card.width);
      changed = true;
    }
    if (card.y + card.height > boundsH) {
      card.y = Math.max(0, boundsH - card.height);
      changed = true;
    }

    if (changed) {
      el.style.left = `${card.x}px`;
      el.style.top = `${card.y}px`;
    }
  });
});

canvasResizeObserver.observe(vizCanvas);

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
  vizOptionsList.innerHTML = VIZ_OPTIONS.map(
    (opt) => `
        <li
            class="viz-option"
            data-option-id="${opt.id}"
            data-option-label="${opt.label}"
            title="${opt.label}"
        >
            ${opt.icon}
        </li>
    `,
  ).join("");

  vizOptionsList.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      const id = li.getAttribute("data-option-id");
      if (id) selectVisualization(id);
    });
  });
}

function selectVisualization(vizId: string) {
  const viz = VIZ_OPTIONS.find((v) => v.id === vizId);
  if (!viz) return;

  addVizCard(vizId);
}

function resetVizOptions() {
  for (const id of [...runningHistograms.keys()]) stopHistogramForCard(id);
  for (const id of [...runningBars.keys()]) stopBarChartForCard(id);

  vizCards = [];
  activeCardId = null;
  selectedColumnIndex = null;

  vizCanvas.querySelectorAll(".viz-card").forEach((el) => el.remove());
  clearGuides();
  vizEmptyState.style.display = "";

  if (settingsPanel.classList.contains("open")) closeSettingsPanel();

  resetProgress();

  renderVizOptions();
  updateColumnsAvailability();
}

// ============================================================
// ПАНЕЛЬ НАСТРОЕК КАРТОЧКИ
// ============================================================

settingsCloseBtn.addEventListener("click", () => closeSettingsPanel());

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

function renderSettingsContent(cardId: string) {
  const card = vizCards.find((c) => c.id === cardId);
  if (!card) {
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
  const isBarChart = card.vizId === "barchart";

  // ---------- Легенда ----------
  let legendFieldsHtml = "";

  if (isHistogram && slot0) {
    legendFieldsHtml += `
      <div class="settings-field">
        <label class="settings-label">Подпись оси X</label>
        <input type="text" class="settings-input"
               data-legend-slot="0"
               value="${escapeHtml(slot0.legendText)}"
               placeholder="${escapeHtml(slot0.name)}"
               ${s.showLegend ? "" : "disabled"} />
      </div>
      <div class="settings-field">
        <label class="settings-label">Подпись оси Y</label>
        <input type="text" class="settings-input"
               data-legend-y
               value="${escapeHtml(s.yLabelOverride)}"
               placeholder="Частота"
               ${s.showLegend ? "" : "disabled"} />
      </div>`;
  }

  if (isBarChart && slot0) {
    legendFieldsHtml += `
      <div class="settings-field">
        <label class="settings-label">Подпись категорий (ось Y)</label>
        <input type="text" class="settings-input"
               data-legend-slot="0"
               value="${escapeHtml(slot0.legendText)}"
               placeholder="${escapeHtml(slot0.name)}"
               ${s.showLegend ? "" : "disabled"} />
      </div>`;

    const xVal = slot1
      ? slot1.legendText
      : s.yLabelOverride || "Количество записей";
    const xPlaceholder = slot1 ? slot1.name : "Количество записей";

    legendFieldsHtml += `
      <div class="settings-field">
        <label class="settings-label">Подпись значений (ось X)</label>
        <input type="text" class="settings-input"
               data-legend-x
               value="${escapeHtml(xVal)}"
               placeholder="${escapeHtml(xPlaceholder)}"
               ${s.showLegend ? "" : "disabled"} />
      </div>`;
  }

  if (!legendFieldsHtml) {
    legendFieldsHtml = `<p class="settings-hint">Сначала перетащите данные ниже — подписи появятся здесь.</p>`;
  }

  // ---------- Данные ----------
  const dataSlotsHtml = isHistogram
    ? `
      <div class="settings-slot">
        <label class="settings-label">Значения (числовая колонка)</label>
        <div class="settings-dropzone" data-dropzone="0">
          ${renderSlotContent(slot0, 0)}
        </div>
      </div>
      <p class="settings-hint">Ось Y (частота) рассчитывается автоматически.</p>
    `
    : `
      <div class="settings-slot">
        <label class="settings-label">Категории (текстовая колонка)</label>
        <div class="settings-dropzone" data-dropzone="0">
          ${renderSlotContent(slot0, 0)}
        </div>
      </div>
      <div class="settings-slot">
        <label class="settings-label">Значения (числовая колонка, опционально)</label>
        <div class="settings-dropzone" data-dropzone="1">
          ${renderSlotContent(slot1, 1)}
        </div>
      </div>
      ${
        !slot1
          ? `<p class="settings-hint">Если не выбрано — считается количество записей.</p>`
          : ""
      }
    `;

  // ---------- Параметры ----------
  let paramsHtml = "";
  if (isHistogram) {
    paramsHtml = `
      <div class="settings-block">
        <h5 class="settings-block-title">Параметры</h5>
        <div class="settings-field">
          <div class="settings-label-row">
            <span class="settings-label">Количество бинов</span>
            <span class="settings-value" data-bins-value>${s.bins}</span>
          </div>
          <input type="range" class="settings-range"
                 data-setting="bins"
                 min="5" max="200" step="1"
                 value="${s.bins}" />
        </div>
        <label class="settings-checkbox">
          <input type="checkbox" data-setting="showGrid" ${s.showGrid ? "checked" : ""} />
          <span>Показывать сетку</span>
        </label>
        <label class="settings-checkbox">
          <input type="checkbox" data-setting="showAxisLabels" ${s.showAxisLabels ? "checked" : ""} />
          <span>Показывать значения на осях</span>
        </label>
      </div>`;
  } else if (isBarChart) {
    paramsHtml = `
      <div class="settings-block">
        <h5 class="settings-block-title">Параметры</h5>
        <div class="settings-field">
          <label class="settings-label">Топ-N категорий (0 = все)</label>
          <input type="number" class="settings-input" min="0" max="10000"
                 data-setting="topN" value="${s.topN}" />
        </div>
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

    ${paramsHtml}

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
    renderSettingsContent(cardId);
    syncCardVisual(card);
    scheduleSaveVizState();
  });

  // ---------- Легенда: слот 0 ----------
  settingsContent
    .querySelectorAll<HTMLInputElement>("[data-legend-slot]")
    .forEach((input) => {
      const i = Number(input.getAttribute("data-legend-slot")) as 0 | 1;
      input.addEventListener("input", () => {
        const slot = s.slots[i];
        if (!slot) return;
        slot.legendText = input.value;
        redrawActive(card);
        scheduleSaveVizState();
      });
    });

  // ---------- Легенда: подпись Y (гистограмма) ----------
  const yOverrideInput = settingsContent.querySelector(
    "[data-legend-y]",
  ) as HTMLInputElement | null;
  if (yOverrideInput) {
    yOverrideInput.addEventListener("input", () => {
      s.yLabelOverride = yOverrideInput.value;
      redrawActive(card);
      scheduleSaveVizState();
    });
  }

  // ---------- Легенда: подпись X (barchart) ----------
  const xOverrideInput = settingsContent.querySelector(
    "[data-legend-x]",
  ) as HTMLInputElement | null;
  if (xOverrideInput) {
    xOverrideInput.addEventListener("input", () => {
      if (slot1) {
        slot1.legendText = xOverrideInput.value;
        redrawActive(card);
      } else {
        s.yLabelOverride = xOverrideInput.value;
        redrawActive(card);
      }
      scheduleSaveVizState();
    });
  }

  // ---------- Бины ----------
  const binsInput = settingsContent.querySelector(
    '[data-setting="bins"]',
  ) as HTMLInputElement | null;
  if (binsInput) {
    binsInput.addEventListener("input", () => {
      s.bins = Number(binsInput.value);
      const lbl = settingsContent.querySelector("[data-bins-value]");
      if (lbl) lbl.textContent = String(s.bins);
    });
    binsInput.addEventListener("change", () => {
      syncCardVisual(card);
    });
  }

  // ---------- Сетка и подписи осей ----------
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

  const axisCheck = settingsContent.querySelector(
    '[data-setting="showAxisLabels"]',
  ) as HTMLInputElement | null;
  if (axisCheck) {
    axisCheck.addEventListener("change", () => {
      s.showAxisLabels = axisCheck.checked;
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
      card.vizId === "histogram" &&
      slotIndex === 0 &&
      ct.type !== "numeric"
    ) {
      reject();
      return;
    }
    if (card.vizId === "barchart") {
      if (slotIndex === 0 && ct.type === "numeric") {
        reject();
        return;
      }
      if (slotIndex === 1 && ct.type !== "numeric") {
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
  const slot0 = card.settings.slots[0];

  if (card.vizId === "histogram" && slot0 && currentData) {
    stopBarChartForCard(card.id);
    runHistogramForCard(card);
    return;
  }

  if (card.vizId === "barchart" && slot0 && currentData) {
    stopHistogramForCard(card.id);
    runBarChartForCard(card);
    return;
  }

  stopHistogramForCard(card.id);
  stopBarChartForCard(card.id);
  refreshCardBody(card);
}

function redrawActive(card: VizCard) {
  const hist = runningHistograms.get(card.id);
  if (hist) {
    hist.renderer.draw(hist.lastState, {
      xLabel: hist.getXLabel(),
      yLabel: hist.getYLabel(),
      showGrid: card.settings.showGrid,
      showAxisLabels: card.settings.showAxisLabels,
      placeholder: "Готовим первую порцию…",
    });
    return;
  }
  const bar = runningBars.get(card.id);
  if (bar) {
    bar.renderer.draw(bar.lastData, {
      xLabel: bar.getXLabel(),
      yLabel: bar.getYLabel(),
      topN: card.settings.topN > 0 ? card.settings.topN : undefined,
    });
    return;
  }
  refreshCardBody(card);
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
}

const runningHistograms = new Map<string, HistogramRun>();

const MAX_BAD_ROWS = 1000;

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

  // ---- Значок об исключённых строках ----
  const totalIssues = stats.nulls + stats.nans + stats.nonNumeric;
  const realErrors = stats.nans + stats.nonNumeric;

  // ---- Лог: что и откуда берём ----
  console.group(
    `%c[Гистограмма ${card.id}] колонка «${slot.name}»`,
    "color:#4a9eff;font-weight:bold",
  );
  console.log(
    `Строк в датасете:    ${stats.totalRows.toLocaleString("ru-RU")}`,
  );
  console.log(`Числовых значений:   ${stats.valid.toLocaleString("ru-RU")}`);
  if (stats.nulls > 0)
    console.log(`  · пустые (null):   ${stats.nulls.toLocaleString("ru-RU")}`);
  if (stats.nans > 0)
    console.log(`  · NaN / Inf:       ${stats.nans.toLocaleString("ru-RU")}`);
  if (stats.nonNumeric > 0)
    console.log(
      `  · не число:        ${stats.nonNumeric.toLocaleString("ru-RU")}`,
    );

  if (data.length === 0) {
    console.warn(
      `Нет ни одного числового значения — визуализация не запускается`,
    );
    console.groupEnd();
    return;
  }
  console.groupEnd();

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
    if (!s || !card.settings.showLegend) return "";
    return s.legendText.trim();
  };
  const getYLabel = () => {
    if (!card.settings.showLegend) return "";
    return card.settings.yLabelOverride.trim();
  };

  const redraw = (state: HistogramChunkResult | null) => {
    renderer.draw(state, {
      xLabel: getXLabel(),
      yLabel: getYLabel(),
      showGrid: card.settings.showGrid,
      showAxisLabels: card.settings.showAxisLabels,
      placeholder: "Готовим первую порцию…",
    });
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    const run = runningHistograms.get(card.id);
    if (run) redraw(run.lastState);
  });
  observer.observe(body);

  // ---------- Tooltip ----------
  const tooltip = document.createElement("div");
  tooltip.className = "viz-tooltip hidden";
  document.body.appendChild(tooltip);

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = renderer.hitTest(x, y);
    if (!hit) {
      tooltip.classList.add("hidden");
      return;
    }
    const w = hit.rangeEnd - hit.rangeStart;
    const digits = w >= 10 ? 0 : w >= 1 ? 1 : 2;
    tooltip.innerHTML = `
      <div class="viz-tooltip-title">диапазон</div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">от</span>
        <span class="viz-tooltip-value">${hit.rangeStart.toFixed(digits)}</span>
      </div>
      <div class="viz-tooltip-row">
        <span class="viz-tooltip-label">до</span>
        <span class="viz-tooltip-value">${hit.rangeEnd.toFixed(digits)}</span>
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

  const onLeave = () => {
    tooltip.classList.add("hidden");
  };

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);

  // ---- Значок, если были исключённые строки: в шапку карточки, после заголовка ----
  let issuesBadge: HTMLElement | null = null;
  if (totalIssues > 0 && el) {
    issuesBadge = document.createElement("div");
    issuesBadge.className =
      "viz-card-issues-badge" + (realErrors > 0 ? " critical" : "");
    issuesBadge.textContent = `⚠ ${totalIssues.toLocaleString("ru-RU")}`;
    issuesBadge.title = "Исключённые строки — нажмите, чтобы посмотреть";
    issuesBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      openBadRowsModal(card.id);
    });
    issuesBadge.addEventListener("dblclick", (e) => e.stopPropagation());

    const header = el.querySelector(".viz-card-header");
    const closeBtn = header?.querySelector(".viz-card-close");
    if (header && closeBtn) {
      header.insertBefore(issuesBadge, closeBtn);
    } else {
      el.appendChild(issuesBadge); // fallback — на случай, если шапки нет
    }
  }

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
  };
  runningHistograms.set(card.id, run);

  redraw(null);

  registerProgressRun(card.id, data.length);

  const handle = runProgressiveHistogram({
    data,
    bins: card.settings.bins,
    onProgress: (state) => {
      run.lastState = state;
      updateProgressRun(card.id, state.processed, state.total);
      redraw(state);
    },
    onDone: (state) => {
      run.lastState = state;
      finishProgressRun(card.id);
      redraw(state);

      // ---- Лог: что отобразилось ----
      const sum = state.counts.reduce((a, b) => a + b, 0);
      const under = state.underflow;
      const over = state.overflow;
      const elapsed = Math.round(performance.now() - t0);

      console.group(
        `%c[Гистограмма ${card.id}] готово за ${elapsed} мс`,
        "color:#16a34a;font-weight:bold",
      );
      console.log(
        `Обработано (C++):    ${state.total.toLocaleString("ru-RU")}`,
      );
      console.log(`Сумма по бинам:      ${sum.toLocaleString("ru-RU")}`);
      console.log(`Underflow / Overflow: ${under} / ${over}`);

      const lost = state.total - sum;
      if (lost === 0 && under === 0 && over === 0) {
        console.log(
          `%c✓ Все значения отображены`,
          "color:#16a34a;font-weight:bold",
        );
      } else {
        console.warn(
          `%c⚠ Не отображено: ${(lost + under + over).toLocaleString("ru-RU")}`,
          "color:#dc2626;font-weight:bold",
        );
        if (lost > 0) console.warn(`   · разница total − sum: ${lost}`);
        if (under > 0) console.warn(`   · underflow (v < min): ${under}`);
        if (over > 0) console.warn(`   · overflow (v > max):  ${over}`);
      }
      console.groupEnd();
    },
  });

  run.handle = handle;
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

badRowsCancel.addEventListener("click", closeBadRowsModal);

function openBadRowsModal(cardId: string) {
  const run = runningHistograms.get(cardId);
  if (!run) return;
  const stats = run.extractionStats;

  const totalIssues = stats.nulls + stats.nans + stats.nonNumeric;
  if (totalIssues === 0) return;

  const parts: string[] = [];
  if (stats.nulls > 0)
    parts.push(`пусто: ${stats.nulls.toLocaleString("ru-RU")}`);
  if (stats.nans > 0)
    parts.push(`NaN / Inf: ${stats.nans.toLocaleString("ru-RU")}`);
  if (stats.nonNumeric > 0)
    parts.push(`не число: ${stats.nonNumeric.toLocaleString("ru-RU")}`);

  badRowsText.innerHTML =
    `Строк в датасете: <b>${stats.totalRows.toLocaleString("ru-RU")}</b>. ` +
    `Учтено: <b>${stats.valid.toLocaleString("ru-RU")}</b>. ` +
    `Исключено: <b>${totalIssues.toLocaleString("ru-RU")}</b> — ${parts.join(", ")}.`;

  const reasonLabel: Record<BadRow["reason"], string> = {
    null: "пусто",
    nan: "NaN / Inf",
    nonNumeric: "не число",
  };

  const renderLimit = 500;
  const shown = stats.badRows.slice(0, renderLimit);

  badRowsTbody.innerHTML = shown
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

  if (totalIssues > renderLimit) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="3" class="bad-rows-more">Показано ${renderLimit.toLocaleString("ru-RU")} из ${totalIssues.toLocaleString("ru-RU")}</td>`;
    badRowsTbody.appendChild(row);
  }

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
  renderer: BarChartRenderer;
  observer: ResizeObserver;
  lastData: BarChartData | null;
  getXLabel: () => string;
  getYLabel: () => string;
}

const runningBars = new Map<string, BarChartRun>();

function aggregateBarChart(
  data: ParsedData,
  categoryIndex: number,
  valueColumnIndex: number | null,
): BarChartData {
  const map = new Map<string, number>();
  const rows = data.rows;

  for (let i = 0; i < rows.length; ++i) {
    const rawCat = rows[i][categoryIndex];
    const key = rawCat == null ? "(пусто)" : String(rawCat);
    const prev = map.get(key) ?? 0;

    if (valueColumnIndex === null) {
      map.set(key, prev + 1);
    } else {
      const raw = rows[i][valueColumnIndex];
      if (raw == null) continue;
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(num)) continue;
      map.set(key, prev + num);
    }
  }

  const categories: BarChartCategory[] = [];
  for (const [label, value] of map.entries()) {
    categories.push({ label, value });
  }
  categories.sort((a, b) => b.value - a.value);

  const metricLabel =
    valueColumnIndex === null
      ? "Количество записей"
      : (data.columnTypes[valueColumnIndex]?.name ?? "Значение");

  return { categories, metricLabel };
}

function runBarChartForCard(card: VizCard) {
  stopBarChartForCard(card.id);

  if (!currentData) return;
  const catSlot = card.settings.slots[0];
  if (!catSlot) return;

  const valSlot = card.settings.slots[1];
  const valIdx = valSlot ? valSlot.columnIndex : null;

  const data = aggregateBarChart(currentData, catSlot.columnIndex, valIdx);

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

  const getYLabel = () => {
    if (!card.settings.showLegend) return "";
    return catSlot.legendText.trim();
  };
  const getXLabel = () => {
    if (!card.settings.showLegend) return "";
    if (valSlot) return valSlot.legendText.trim();
    return card.settings.yLabelOverride.trim();
  };

  const redraw = () => {
    renderer.draw(data, {
      xLabel: getXLabel(),
      yLabel: getYLabel(),
      topN: card.settings.topN > 0 ? card.settings.topN : undefined,
    });
  };

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    redraw();
  });
  observer.observe(body);

  runningBars.set(card.id, {
    renderer,
    observer,
    lastData: data,
    getXLabel,
    getYLabel,
  });

  redraw();
}

function stopBarChartForCard(cardId: string) {
  const run = runningBars.get(cardId);
  if (!run) return;
  run.observer.disconnect();
  runningBars.delete(cardId);
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