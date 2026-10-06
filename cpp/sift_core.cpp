#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <vector>
#include <cstdint>
#include <cmath>
#include <limits>
#include <algorithm>

using namespace emscripten;

// ============================================================
// ПРЕДВАРИТЕЛЬНЫЕ ОБЪЯВЛЕНИЯ
// ============================================================

// Определяется ниже (в секции Bucketed Histogram),
// но используется в Grouped Histogram — поэтому объявляем заранее.
static inline bool bucketMatches(
    double v,
    int32_t op,
    double v1,
    double v2
);

// ============================================================
// СОСТОЯНИЕ ПРОГРЕССИВНОГО АГРЕГАТОРА
// ============================================================

struct HistogramState
{
    const double *data = nullptr;
    unsigned int length = 0;
    unsigned int bins = 0;
    double minValue = 0.0;
    double maxValue = 1.0;
    double binWidth = 1.0;

    // counts[0] — underflow, counts[1..bins] — сами корзины,
    // counts[bins+1] — overflow
    std::vector<uint32_t> counts;

    unsigned int processed = 0;
};

// ------------------------------------------------------------
// Быстрый проход для определения диапазона [min, max].
// NaN игнорируется.
// ------------------------------------------------------------

static void computeRange(
    const double *data,
    unsigned int length,
    double &outMin,
    double &outMax)
{
    if (length == 0)
    {
        outMin = 0.0;
        outMax = 1.0;
        return;
    }

    double mn = std::numeric_limits<double>::infinity();
    double mx = -std::numeric_limits<double>::infinity();
    bool found = false;

    for (unsigned int i = 0; i < length; ++i)
    {
        double v = data[i];
        if (std::isnan(v))
            continue;
        if (!found)
        {
            mn = v;
            mx = v;
            found = true;
        }
        else
        {
            if (v < mn)
                mn = v;
            if (v > mx)
                mx = v;
        }
    }
    if (!found)
    {
        mn = 0.0;
        mx = 1.0;
    }
    outMin = mn;
    outMax = mx;
}

// ============================================================
// АЛЛОКАЦИЯ ПАМЯТИ ПОД МАССИВ ЧИСЕЛ
// ============================================================

unsigned int allocF64(unsigned int count)
{
    double *p = new double[count];
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(p));
}

void freeF64(unsigned int ptr)
{
    double *p = reinterpret_cast<double *>(static_cast<uintptr_t>(ptr));
    delete[] p;
}

// ============================================================
// ПРОГРЕССИВНАЯ ГИСТОГРАММА
// ============================================================

unsigned int initHistogram(
    unsigned int dataPtr,
    unsigned int length,
    unsigned int bins)
{
    if (bins == 0)
        bins = 1;

    auto *st = new HistogramState();
    st->data = reinterpret_cast<const double *>(static_cast<uintptr_t>(dataPtr));
    st->length = length;
    st->bins = bins;

    computeRange(st->data, length, st->minValue, st->maxValue);

    if (st->maxValue <= st->minValue)
    {
        st->maxValue = st->minValue + 1.0;
    }
    st->binWidth = (st->maxValue - st->minValue) / static_cast<double>(bins);

    st->counts.assign(bins + 2, 0);
    st->processed = 0;

    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(st));
}

emscripten::val processNextChunk(unsigned int handle, unsigned int elements)
{
    auto *st = reinterpret_cast<HistogramState *>(static_cast<uintptr_t>(handle));
    if (!st)
        return emscripten::val::null();

    const unsigned int start = st->processed;
    const unsigned int end = std::min(start + elements, st->length);

    const double minV = st->minValue;
    const double binW = st->binWidth;
    const unsigned int bins = st->bins;

    for (unsigned int i = start; i < end; ++i)
    {
        double v = st->data[i];
        if (std::isnan(v))
            continue;

        unsigned int idx;
               if (v < minV) {
            idx = 0;
        } else if (v > st->maxValue) {
            idx = bins + 1;
        } else {
            double rel = (v - minV) / binW;
            idx = 1 + static_cast<unsigned int>(rel);
            if (idx > bins)
                idx = bins;
        }
        st->counts[idx] += 1;
    }

    st->processed = end;

    emscripten::val jsCounts = emscripten::val::array();
    for (unsigned int b = 0; b < bins; ++b)
    {
        jsCounts.call<void>("push", st->counts[b + 1]);
    }

    emscripten::val result = emscripten::val::object();
    result.set("processed", static_cast<double>(st->processed));
    result.set("total", static_cast<double>(st->length));
    result.set("bins", static_cast<double>(bins));
    result.set("counts", jsCounts);
    result.set("min", st->minValue);
    result.set("max", st->maxValue);
    result.set("underflow", static_cast<double>(st->counts[0]));
    result.set("overflow", static_cast<double>(st->counts[bins + 1]));
    result.set("done", st->processed >= st->length);
    return result;
}

void freeHistogram(unsigned int handle)
{
    auto *st = reinterpret_cast<HistogramState *>(static_cast<uintptr_t>(handle));
    delete st;
}

// ============================================================
// ПРОГРЕССИВНЫЙ BAR CHART
// ============================================================
//
// JS заранее маппит строковые категории в int32-индексы.
// C++ оперирует только числами: catIndices + опционально values.
// Если values == nullptr — считается count, иначе — сумма.

struct BarChartState {
    const int32_t* catIndices = nullptr;
    const double*  values = nullptr;
    unsigned int   length = 0;
    unsigned int   numCategories = 0;
    bool           hasValues = false;

    std::vector<double> acc;
    unsigned int processed = 0;
};

unsigned int allocI32(unsigned int count) {
    int32_t* p = new int32_t[count];
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(p));
}

void freeI32(unsigned int ptr) {
    int32_t* p = reinterpret_cast<int32_t*>(static_cast<uintptr_t>(ptr));
    delete[] p;
}

unsigned int initBarChart(
    unsigned int catIndicesPtr,
    unsigned int valuesPtr,
    unsigned int length,
    unsigned int numCategories
) {
    auto* st = new BarChartState();
    st->catIndices = reinterpret_cast<const int32_t*>(
        static_cast<uintptr_t>(catIndicesPtr));
    st->values = valuesPtr
        ? reinterpret_cast<const double*>(static_cast<uintptr_t>(valuesPtr))
        : nullptr;
    st->length = length;
    st->numCategories = numCategories;
    st->hasValues = (valuesPtr != 0);
    st->acc.assign(numCategories, 0.0);
    st->processed = 0;
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(st));
}

emscripten::val processBarChartChunk(
    unsigned int handle,
    unsigned int elements
) {
    auto* st = reinterpret_cast<BarChartState*>(static_cast<uintptr_t>(handle));
    if (!st) return emscripten::val::null();

    const unsigned int start = st->processed;
    const unsigned int end = std::min(start + elements, st->length);

    const int32_t* cats = st->catIndices;
    const double*  vals = st->values;
    const unsigned int nCats = st->numCategories;
    const bool useVals = st->hasValues;

    for (unsigned int i = start; i < end; ++i) {
        int32_t cat = cats[i];
        if (cat < 0 || static_cast<unsigned int>(cat) >= nCats) continue;

        if (useVals) {
            double v = vals[i];
            if (std::isnan(v)) continue;
            st->acc[cat] += v;
        } else {
            st->acc[cat] += 1.0;
        }
    }

    st->processed = end;

    emscripten::val jsValues = emscripten::val::array();
    for (unsigned int i = 0; i < nCats; ++i) {
        jsValues.call<void>("push", st->acc[i]);
    }

    emscripten::val result = emscripten::val::object();
    result.set("processed",  static_cast<double>(st->processed));
    result.set("total",      static_cast<double>(st->length));
    result.set("categories", static_cast<double>(nCats));
    result.set("values",     jsValues);
    result.set("done",       st->processed >= st->length);
    return result;
}

void freeBarChart(unsigned int handle) {
    auto* st = reinterpret_cast<BarChartState*>(static_cast<uintptr_t>(handle));
    delete st;
}

// ============================================================
// ГРУППИРОВАННАЯ ГИСТОГРАММА (BUCKETED, 2D)
// ============================================================
//
// Аналог bucketed histogram, но counts — 2D-матрица
// [bucket][category]. Размер = numBuckets * numCategories.
// Бакеты задаются так же, как в bucketed histogram:
// ops, v1s, v2s (коды операторов, значения 1 и 2).

struct GroupedHistogramState {
    const double*  data = nullptr;
    const int32_t* catIndices = nullptr;
    unsigned int   length = 0;

    const int32_t* ops = nullptr;
    const double*  v1s = nullptr;
    const double*  v2s = nullptr;
    unsigned int   numBuckets = 0;
    unsigned int   numCategories = 0;

    // counts[b * numCategories + c]
    std::vector<uint32_t> counts;
    unsigned int outOfBuckets = 0;
    unsigned int processed = 0;
};

unsigned int initGroupedHistogram(
    unsigned int dataPtr,
    unsigned int catIndicesPtr,
    unsigned int length,
    unsigned int opsPtr,
    unsigned int v1Ptr,
    unsigned int v2Ptr,
    unsigned int numBuckets,
    unsigned int numCategories
) {
    if (numBuckets == 0) numBuckets = 1;
    if (numCategories == 0) numCategories = 1;

    auto* st = new GroupedHistogramState();
    st->data         = reinterpret_cast<const double*>(static_cast<uintptr_t>(dataPtr));
    st->catIndices   = reinterpret_cast<const int32_t*>(static_cast<uintptr_t>(catIndicesPtr));
    st->length       = length;
    st->ops          = reinterpret_cast<const int32_t*>(static_cast<uintptr_t>(opsPtr));
    st->v1s          = reinterpret_cast<const double*>(static_cast<uintptr_t>(v1Ptr));
    st->v2s          = reinterpret_cast<const double*>(static_cast<uintptr_t>(v2Ptr));
    st->numBuckets   = numBuckets;
    st->numCategories = numCategories;
    st->counts.assign(numBuckets * numCategories, 0);
    st->outOfBuckets = 0;
    st->processed    = 0;
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(st));
}

emscripten::val processGroupedHistogramChunk(
    unsigned int handle,
    unsigned int elements
) {
    auto* st = reinterpret_cast<GroupedHistogramState*>(static_cast<uintptr_t>(handle));
    if (!st) return emscripten::val::null();

    const unsigned int start = st->processed;
    const unsigned int end   = std::min(start + elements, st->length);

    const unsigned int nB = st->numBuckets;
    const unsigned int nC = st->numCategories;
    const int32_t* ops = st->ops;
    const double*  v1s = st->v1s;
    const double*  v2s = st->v2s;

    for (unsigned int i = start; i < end; ++i) {
        double v = st->data[i];
        if (std::isnan(v)) continue;

        int32_t cat = st->catIndices[i];
        if (cat < 0 || static_cast<unsigned int>(cat) >= nC) continue;

        // Первое совпадение выигрывает
        bool matched = false;
        for (unsigned int b = 0; b < nB; ++b) {
            if (bucketMatches(v, ops[b], v1s[b], v2s[b])) {
                st->counts[b * nC + cat] += 1;
                matched = true;
                break;
            }
        }
        if (!matched) st->outOfBuckets += 1;
    }

    st->processed = end;

    emscripten::val jsCounts = emscripten::val::array();
    for (size_t i = 0; i < st->counts.size(); ++i) {
        jsCounts.call<void>("push", st->counts[i]);
    }

    emscripten::val result = emscripten::val::object();
    result.set("processed",     static_cast<double>(st->processed));
    result.set("total",         static_cast<double>(st->length));
    result.set("numBuckets",    static_cast<double>(nB));
    result.set("numCategories", static_cast<double>(nC));
    result.set("counts",        jsCounts);
    result.set("outOfBuckets",  static_cast<double>(st->outOfBuckets));
    result.set("done",          st->processed >= st->length);
    return result;
}

void freeGroupedHistogram(unsigned int handle) {
    auto* st = reinterpret_cast<GroupedHistogramState*>(static_cast<uintptr_t>(handle));
    delete st;
}

// ============================================================
// ГИСТОГРАММА С ПРОИЗВОЛЬНЫМИ ГРУППАМИ (BUCKETED HISTOGRAM)
// ============================================================
// JS передаёт четыре параллельных массива длины numBuckets:
//   ops[i] — код оператора, -1 = группа невалидна (пропускается)
//   v1s[i] — первое значение условия
//   v2s[i] — второе значение (только для range, иначе игнорируется)
//
// Коды операторов:
//   0 = lt   (<)
//   1 = lte  (<=)
//   2 = gt   (>)
//   3 = gte  (>=)
//   4 = eq   (=)
//   5 = neq  (!=)
//   6 = range (v1 <= x <= v2, оба конца включительны)

struct BucketedHistogramState {
    const double* data = nullptr;
    unsigned int  length = 0;
    unsigned int  numBuckets = 0;

    const int32_t* ops = nullptr;
    const double*  v1s = nullptr;
    const double*  v2s = nullptr;

    std::vector<uint32_t> counts;
    unsigned int outOfBuckets = 0;
    unsigned int processed = 0;
};

static inline bool bucketMatches(
    double v,
    int32_t op,
    double v1,
    double v2
) {
    switch (op) {
        case 0: return v <  v1;
        case 1: return v <= v1;
        case 2: return v >  v1;
        case 3: return v >= v1;
        case 4: return v == v1;
        case 5: return v != v1;
        case 6: return v >= v1 && v <= v2;
        default: return false;   // op == -1 или неизвестный
    }
}

unsigned int initBucketedHistogram(
    unsigned int dataPtr,
    unsigned int length,
    unsigned int opsPtr,
    unsigned int v1Ptr,
    unsigned int v2Ptr,
    unsigned int numBuckets
) {
    auto* st = new BucketedHistogramState();
    st->data       = reinterpret_cast<const double*>(static_cast<uintptr_t>(dataPtr));
    st->length     = length;
    st->numBuckets = numBuckets;
    st->ops        = reinterpret_cast<const int32_t*>(static_cast<uintptr_t>(opsPtr));
    st->v1s        = reinterpret_cast<const double*>(static_cast<uintptr_t>(v1Ptr));
    st->v2s        = reinterpret_cast<const double*>(static_cast<uintptr_t>(v2Ptr));
    st->counts.assign(numBuckets, 0);
    st->outOfBuckets = 0;
    st->processed = 0;
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(st));
}

emscripten::val processBucketedHistogramChunk(
    unsigned int handle,
    unsigned int elements
) {
    auto* st = reinterpret_cast<BucketedHistogramState*>(static_cast<uintptr_t>(handle));
    if (!st) return emscripten::val::null();

    const unsigned int start = st->processed;
    const unsigned int end   = std::min(start + elements, st->length);
    const unsigned int nB    = st->numBuckets;
    const int32_t* ops = st->ops;
    const double*  v1s = st->v1s;
    const double*  v2s = st->v2s;

    for (unsigned int i = start; i < end; ++i) {
        double v = st->data[i];
        if (std::isnan(v)) continue;

        bool matched = false;
        for (unsigned int b = 0; b < nB; ++b) {
            if (bucketMatches(v, ops[b], v1s[b], v2s[b])) {
                st->counts[b] += 1;
                matched = true;
                break;   // первое совпадение выигрывает
            }
        }
        if (!matched) st->outOfBuckets += 1;
    }

    st->processed = end;

    emscripten::val jsCounts = emscripten::val::array();
    for (unsigned int i = 0; i < nB; ++i) {
        jsCounts.call<void>("push", st->counts[i]);
    }

    emscripten::val result = emscripten::val::object();
    result.set("processed",    static_cast<double>(st->processed));
    result.set("total",        static_cast<double>(st->length));
    result.set("buckets",      static_cast<double>(nB));
    result.set("counts",       jsCounts);
    result.set("outOfBuckets", static_cast<double>(st->outOfBuckets));
    result.set("done",         st->processed >= st->length);
    return result;
}

void freeBucketedHistogram(unsigned int handle) {
    auto* st = reinterpret_cast<BucketedHistogramState*>(static_cast<uintptr_t>(handle));
    delete st;
}

// ============================================================
// EMBIND
// ============================================================

EMSCRIPTEN_BINDINGS(sift_core)
{
    function("allocF64", &allocF64);
    function("freeF64", &freeF64);
    function("initHistogram", &initHistogram);
    function("processNextChunk", &processNextChunk);
    function("freeHistogram", &freeHistogram);
    function("allocI32",            &allocI32);
    function("freeI32",             &freeI32);
    function("initBarChart",        &initBarChart);
    function("processBarChartChunk", &processBarChartChunk);
    function("freeBarChart",        &freeBarChart);
    function("initBucketedHistogram", &initBucketedHistogram);
    function("processBucketedHistogramChunk", &processBucketedHistogramChunk);
    function("freeBucketedHistogram", &freeBucketedHistogram);
    function("initGroupedHistogram", &initGroupedHistogram);
    function("processGroupedHistogramChunk", &processGroupedHistogramChunk);
    function("freeGroupedHistogram", &freeGroupedHistogram);
}