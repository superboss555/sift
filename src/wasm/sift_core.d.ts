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

export interface BarChartChunkResult {
  processed: number;
  total: number;
  categories: number;
  values: number[];
  done: boolean;
}

export interface BucketedHistogramChunkResult {
  processed: number;
  total: number;
  buckets: number;
  counts: number[];
  outOfBuckets: number;
  done: boolean;
}

export interface GroupedHistogramChunkResult {
  processed: number;
  total: number;
  numBuckets: number;
  numCategories: number;
  counts: number[];
  outOfBuckets: number;
  done: boolean;
}

export interface SiftCoreModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;

  // ---- Память ----
  allocF64(count: number): number;
  freeF64(ptr: number): void;
  allocI32(count: number): number;
  freeI32(ptr: number): void;

  // ---- Гистограмма ----
  initHistogram(dataPtr: number, length: number, bins: number): number;
  processNextChunk(handle: number, elements: number): HistogramChunkResult;
  freeHistogram(handle: number): void;

  // ---- Bar chart ----
  initBarChart(
    catIndicesPtr: number,
    valuesPtr: number,
    length: number,
    numCategories: number,
  ): number;
  processBarChartChunk(handle: number, elements: number): BarChartChunkResult;
  freeBarChart(handle: number): void;

  // ---- Grouped Histogram ----
  initGroupedHistogram(
    dataPtr: number,
    catIndicesPtr: number,
    length: number,
    opsPtr: number,
    v1Ptr: number,
    v2Ptr: number,
    numBuckets: number,
    numCategories: number,
  ): number;
  processGroupedHistogramChunk(
    handle: number,
    elements: number,
  ): GroupedHistogramChunkResult;
  freeGroupedHistogram(handle: number): void;

  // ---- Bucketed histogram ----
  initBucketedHistogram(
    dataPtr: number,
    length: number,
    opsPtr: number,
    v1Ptr: number,
    v2Ptr: number,
    numBuckets: number,
  ): number;
  processBucketedHistogramChunk(
    handle: number,
    elements: number,
  ): BucketedHistogramChunkResult;
  freeBucketedHistogram(handle: number): void;
}

declare function createSiftCore(): Promise<SiftCoreModule>;
export default createSiftCore;