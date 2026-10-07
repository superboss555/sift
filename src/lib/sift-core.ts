import createSiftCore, {
  type SiftCoreModule,
  type HistogramChunkResult,
  type BarChartChunkResult,
  type BucketedHistogramChunkResult,
  type GroupedHistogramChunkResult,
} from "../wasm/sift_core.js";

export type {
  HistogramChunkResult,
  BarChartChunkResult,
  BucketedHistogramChunkResult,
  GroupedHistogramChunkResult,
};

// ============================================================
// РАСШИРЕНИЕ ТИПА WASM-МОДУЛЯ
// ============================================================
//
// Методы Box Plot (P²) уже экспортированы из C++ через
// EMSCRIPTEN_BINDINGS, но в сгенерированном sift_core.d.ts их
// ещё нет, потому что модуль был собран до правок C++. Чтобы не
// редактировать генерируемый файл (он перезапишется при следующей
// сборке), расширяем тип SiftCoreModule здесь.
//
// Альтернатива: пересобрать WASM (тогда .d.ts сгенерируется заново
// и этот блок можно удалить).

declare module "../wasm/sift_core.js" {
  interface SiftCoreModule {
    initBoxPlot(dataPtr: number, length: number): number;
    processBoxPlotChunk(
      handle: number,
      elements: number,
    ): {
      processed: number;
      total: number;
      q1: number;
      median: number;
      q3: number;
      iqr: number;
      min: number;
      max: number;
      count: number;
      done: boolean;
    };
    freeBoxPlot(handle: number): void;
  }
}

let corePromise: Promise<SiftCoreModule> | null = null;

/** Один экземпляр WASM-модуля на всё приложение. */
export function getCore(): Promise<SiftCoreModule> {
  if (!corePromise) corePromise = createSiftCore();
  return corePromise;
}

// ============================================================
// ПРОГРЕССИВНАЯ ГИСТОГРАММА
// ============================================================

export interface HistogramHandle {
  cancel(): void;
}

export interface ProgressiveHistogramOptions {
  data: Float64Array;
  bins: number;
  chunkPerFrame?: number;
  onProgress: (state: HistogramChunkResult) => void;
  onDone?: (state: HistogramChunkResult) => void;
}

export function runProgressiveHistogram(
  opts: ProgressiveHistogramOptions,
): HistogramHandle {
  let cancelled = false;
  let rafId = 0;
  let cleanupFn: (() => void) | null = null;

  void (async () => {
    try {
      const core = await getCore();
      if (cancelled) return;

      const { data, bins, onProgress, onDone } = opts;
      const chunkPerFrame =
        opts.chunkPerFrame ?? Math.max(10_000, Math.ceil(data.length / 100));

      const dataPtr = core.allocF64(data.length);
      core.HEAPF64.set(data, dataPtr / 8);

      const handle = core.initHistogram(dataPtr, data.length, bins);

      cleanupFn = () => {
        core.freeHistogram(handle);
        core.freeF64(dataPtr);
      };

      const step = () => {
        if (cancelled) return;
        const state = core.processNextChunk(handle, chunkPerFrame);
        onProgress(state);

        if (state.done) {
          cleanupFn?.();
          cleanupFn = null;
          onDone?.(state);
        } else {
          rafId = requestAnimationFrame(step);
        }
      };

      rafId = requestAnimationFrame(step);
    } catch (err) {
      console.error("[sift-core] ошибка прогрессивной гистограммы:", err);
    }
  })();

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(rafId);
      cleanupFn?.();
      cleanupFn = null;
    },
  };
}

// ============================================================
// ПРОГРЕССИВНЫЙ BAR CHART
// ============================================================

export interface BarChartHandle {
  cancel(): void;
}

export interface ProgressiveBarChartOptions {
  /** Для каждой строки — индекс её категории (0..numCategories-1). */
  catIndices: Int32Array;
  /** Опционально: значения для sum-агрегации. null → count. */
  values: Float64Array | null;
  numCategories: number;
  chunkPerFrame?: number;
  onProgress: (state: BarChartChunkResult) => void;
  onDone?: (state: BarChartChunkResult) => void;
}

export function runProgressiveBarChart(
  opts: ProgressiveBarChartOptions,
): BarChartHandle {
  let cancelled = false;
  let rafId = 0;
  let cleanupFn: (() => void) | null = null;

  void (async () => {
    try {
      const core = await getCore();
      if (cancelled) return;

      // ---- Проверка: модуль собран с HEAP32? ----
      if (!core.HEAP32) {
        console.error(
          "%c[sift-core] WASM собран БЕЗ HEAP32.\n" +
            "Пересоберите модуль командой:\n" +
            "  em++ cpp/sift_core.cpp -O2 -o src/wasm/sift_core.js ^\n" +
            "    -lembind -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web ^\n" +
            "    -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_RUNTIME_METHODS=HEAPF64,HEAP32",
          "color:#dc2626;font-weight:bold",
        );
        return;
      }
      if (typeof core.initBarChart !== "function") {
        console.error(
          "%c[sift-core] в WASM нет функции initBarChart. " +
            "Скорее всего модуль не пересобран после правок C++.",
          "color:#dc2626;font-weight:bold",
        );
        return;
      }

      const { catIndices, values, numCategories, onProgress, onDone } = opts;
      const len = catIndices.length;

      console.log(
        `[sift-core] запускаю bar chart: len=${len}, numCategories=${numCategories}`,
      );

      const chunkPerFrame =
        opts.chunkPerFrame ?? Math.max(10_000, Math.ceil(len / 100));

      // 1. Категории → heap WASM
      const catPtr = core.allocI32(len);
      core.HEAP32.set(catIndices, catPtr / 4);

      // 2. Значения (опционально)
      let valPtr = 0;
      if (values) {
        valPtr = core.allocF64(values.length);
        core.HEAPF64.set(values, valPtr / 8);
      }

      const handle = core.initBarChart(catPtr, valPtr, len, numCategories);
      console.log(`[sift-core] bar chart handle = ${handle}`);

      cleanupFn = () => {
        core.freeBarChart(handle);
        core.freeI32(catPtr);
        if (valPtr) core.freeF64(valPtr);
      };

      const step = () => {
        if (cancelled) return;
        const state = core.processBarChartChunk(handle, chunkPerFrame);
        if (!state) {
          console.warn("[sift-core] processBarChartChunk вернул null");
          return;
        }
        onProgress(state);

        if (state.done) {
          cleanupFn?.();
          cleanupFn = null;
          onDone?.(state);
        } else {
          rafId = requestAnimationFrame(step);
        }
      };

      rafId = requestAnimationFrame(step);
    } catch (err) {
      console.error(
        "%c[sift-core] ошибка прогрессивного bar chart:",
        "color:#dc2626;font-weight:bold",
        err,
      );
    }
  })();

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(rafId);
      cleanupFn?.();
      cleanupFn = null;
    },
  };
}

// ============================================================
// ПРОГРЕССИВНАЯ ГРУППИРОВАННАЯ ГИСТОГРАММА
// ============================================================

export interface GroupedHistogramHandle {
  cancel(): void;
}

export interface ProgressiveGroupedHistogramOptions {
  data: Float64Array;
  catIndices: Int32Array;
  numCategories: number;
  /** Коды операторов (0..6, -1 = невалидная группа). */
  ops: Int32Array;
  /** Первое значение условия. */
  v1s: Float64Array;
  /** Второе значение (для range). */
  v2s: Float64Array;
  numBuckets: number;
  chunkPerFrame?: number;
  onProgress: (state: GroupedHistogramChunkResult) => void;
  onDone?: (state: GroupedHistogramChunkResult) => void;
}

export function runProgressiveGroupedHistogram(
  opts: ProgressiveGroupedHistogramOptions,
): GroupedHistogramHandle {
  let cancelled = false;
  let rafId = 0;
  let cleanupFn: (() => void) | null = null;

  void (async () => {
    try {
      const core = await getCore();
      if (cancelled) return;

      const {
        data, catIndices, numCategories,
        ops, v1s, v2s, numBuckets,
        onProgress, onDone,
      } = opts;
      const chunkPerFrame =
        opts.chunkPerFrame ?? Math.max(10_000, Math.ceil(data.length / 100));

      const dataPtr = core.allocF64(data.length);
      core.HEAPF64.set(data, dataPtr / 8);

      const catPtr = core.allocI32(catIndices.length);
      core.HEAP32.set(catIndices, catPtr / 4);

      const opsPtr = core.allocI32(numBuckets);
      core.HEAP32.set(ops, opsPtr / 4);

      const v1Ptr = core.allocF64(numBuckets);
      core.HEAPF64.set(v1s, v1Ptr / 8);

      const v2Ptr = core.allocF64(numBuckets);
      core.HEAPF64.set(v2s, v2Ptr / 8);

      const handle = core.initGroupedHistogram(
        dataPtr,
        catPtr,
        data.length,
        opsPtr,
        v1Ptr,
        v2Ptr,
        numBuckets,
        numCategories,
      );

      cleanupFn = () => {
        core.freeGroupedHistogram(handle);
        core.freeF64(dataPtr);
        core.freeI32(catPtr);
        core.freeI32(opsPtr);
        core.freeF64(v1Ptr);
        core.freeF64(v2Ptr);
      };

      const step = () => {
        if (cancelled) return;
        const state = core.processGroupedHistogramChunk(handle, chunkPerFrame);
        onProgress(state);

        if (state.done) {
          cleanupFn?.();
          cleanupFn = null;
          onDone?.(state);
        } else {
          rafId = requestAnimationFrame(step);
        }
      };

      rafId = requestAnimationFrame(step);
    } catch (err) {
      console.error("[sift-core] ошибка группированной гистограммы:", err);
    }
  })();

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(rafId);
      cleanupFn?.();
      cleanupFn = null;
    },
  };
}

// ============================================================
// ГИСТОГРАММА С ПРОИЗВОЛЬНЫМИ ГРУППАМИ
// ============================================================

export interface BucketedHistogramHandle {
  cancel(): void;
}

export interface ProgressiveBucketedHistogramOptions {
  data: Float64Array;
  /** Коды операторов (0..6, -1 = невалидная группа). */
  ops: Int32Array;
  /** Первое значение условия. */
  v1s: Float64Array;
  /** Второе значение (для range). */
  v2s: Float64Array;
  numBuckets: number;
  chunkPerFrame?: number;
  onProgress: (state: BucketedHistogramChunkResult) => void;
  onDone?: (state: BucketedHistogramChunkResult) => void;
}

export function runProgressiveBucketedHistogram(
  opts: ProgressiveBucketedHistogramOptions,
): BucketedHistogramHandle {
  let cancelled = false;
  let rafId = 0;
  let cleanupFn: (() => void) | null = null;

  void (async () => {
    try {
      const core = await getCore();
      if (cancelled) return;

      const { data, ops, v1s, v2s, numBuckets, onProgress, onDone } = opts;
      const len = data.length;
      const chunkPerFrame =
        opts.chunkPerFrame ?? Math.max(10_000, Math.ceil(len / 100));

      const dataPtr = core.allocF64(len);
      core.HEAPF64.set(data, dataPtr / 8);

      const opsPtr = core.allocI32(numBuckets);
      core.HEAP32.set(ops, opsPtr / 4);

      const v1Ptr = core.allocF64(numBuckets);
      core.HEAPF64.set(v1s, v1Ptr / 8);

      const v2Ptr = core.allocF64(numBuckets);
      core.HEAPF64.set(v2s, v2Ptr / 8);

      const handle = core.initBucketedHistogram(
        dataPtr,
        len,
        opsPtr,
        v1Ptr,
        v2Ptr,
        numBuckets,
      );

      cleanupFn = () => {
        core.freeBucketedHistogram(handle);
        core.freeF64(dataPtr);
        core.freeI32(opsPtr);
        core.freeF64(v1Ptr);
        core.freeF64(v2Ptr);
      };

      const step = () => {
        if (cancelled) return;
        const state = core.processBucketedHistogramChunk(handle, chunkPerFrame);
        onProgress(state);

        if (state.done) {
          cleanupFn?.();
          cleanupFn = null;
          onDone?.(state);
        } else {
          rafId = requestAnimationFrame(step);
        }
      };

      rafId = requestAnimationFrame(step);
    } catch (err) {
      console.error("[sift-core] ошибка bucketed histogram:", err);
    }
  })();

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(rafId);
      cleanupFn?.();
      cleanupFn = null;
    },
  };
}

// ============================================================
// BOX PLOT (P²)
// ============================================================

export interface BoxPlotChunkResult {
  processed: number;
  total: number;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  count: number;
  done: boolean;
  /** Границы усов (Q1 − 1.5·IQR и Q3 + 1.5·IQR). Валидны после done. */
  upperFence: number;
  lowerFence: number;
  /** Полное число выбросов (может быть больше, чем реально переданных). */
  upperOutlierCount: number;
  lowerOutlierCount: number;
  /** Сами значения выбросов (первые MAX_OUTLIERS = 500). */
  upperOutliers: number[];
  lowerOutliers: number[];
}

export interface BoxPlotHandle {
  cancel: () => void;
}

export function runProgressiveBoxPlot(args: {
  data: Float64Array;
  onProgress: (state: BoxPlotChunkResult) => void;
  onDone: (state: BoxPlotChunkResult) => void;
}): BoxPlotHandle {
  let cancelled = false;
  let rafId = 0;
  let cleanupFn: (() => void) | null = null;

  void (async () => {
    try {
      const core = await getCore();
      if (cancelled) return;

      const { data, onProgress, onDone } = args;

      const dataPtr = core.allocF64(data.length);
      core.HEAPF64.set(data, dataPtr / 8);

      const handle = core.initBoxPlot(dataPtr, data.length);

      cleanupFn = () => {
        core.freeBoxPlot(handle);
        core.freeF64(dataPtr);
      };

      const CHUNK = 20000;

      const step = () => {
        if (cancelled) return;

        let state: BoxPlotChunkResult;
        try {
          state = core.processBoxPlotChunk(
            handle,
            CHUNK,
          ) as BoxPlotChunkResult;
        } catch (err) {
          console.error("[boxplot] chunk error:", err);
          cleanupFn?.();
          cleanupFn = null;
          return;
        }

        onProgress(state);

        if (state.done) {
          cleanupFn?.();
          cleanupFn = null;
          onDone(state);
        } else {
          rafId = requestAnimationFrame(step);
        }
      };

      rafId = requestAnimationFrame(step);
    } catch (err) {
      console.error("[sift-core] ошибка box plot:", err);
    }
  })();

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(rafId);
      cleanupFn?.();
      cleanupFn = null;
    },
  };
}