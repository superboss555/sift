import createSiftCore, {
  type SiftCoreModule,
  type HistogramChunkResult,
} from "../wasm/sift_core.js";

export type { HistogramChunkResult };

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