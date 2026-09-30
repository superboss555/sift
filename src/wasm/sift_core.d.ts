export interface HistogramChunkResult {
  processed: number;
  total: number;
  bins: number;
  counts: number[];
  min: number;
  max: number;
  underflow: number;
  overflow: number;
  done: boolean;
}

export interface SiftCoreModule {
  HEAPF64: Float64Array;

  allocF64(count: number): number;
  freeF64(ptr: number): void;

  initHistogram(dataPtr: number, length: number, bins: number): number;
  processNextChunk(handle: number, elements: number): HistogramChunkResult;
  freeHistogram(handle: number): void;
}

declare function createSiftCore(): Promise<SiftCoreModule>;
export default createSiftCore;