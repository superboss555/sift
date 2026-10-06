// ============================================================
// ХРАНЕНИЕ СОСТОЯНИЯ ВИЗУАЛИЗАЦИЙ
// ============================================================
//
// Отдельная IndexedDB, привязанная к файлу по имени.
// Хранит карточки, их позиции, размеры, настройки и активную карточку.

const DB_NAME = "sift-viz-state";
const DB_VERSION = 1;
const STORE_NAME = "state";
const KEY = "latest";

export interface SerializedDataSlot {
  columnIndex: number;
  name: string;
  legendText: string;
}

export interface SerializedBucket {
  id: string;
  name: string;
  operator: string;
  value1: number | null;
  value2: number | null;
}

export interface SerializedCardSettings {
  title: string;
  showLegend: boolean;
  showAxisLabels?: boolean;
  legendText?: string;
  slots: [SerializedDataSlot | null, SerializedDataSlot | null];
  bins: number;
  yLabelOverride: string;
  topN: number;
  showGrid: boolean;
  precision?: number;
  buckets?: SerializedBucket[];
  bucketsShowName?: boolean;
  renderMode?: "grouped" | "stacked";
}

export interface SerializedVizCard {
  id: string;
  vizId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  settings: SerializedCardSettings;
}

export interface VizState {
  fileName: string;
  savedAt: number;
  cards: SerializedVizCard[];
  activeCardId: string | null;
  cardCounter: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveVizState(state: VizState): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(state, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadVizState(): Promise<VizState | null> {
  const db = await openDb();
  try {
    return await new Promise<VizState | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve((req.result as VizState) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function clearVizState(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}