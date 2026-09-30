#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <vector>
#include <cstdint>
#include <cmath>
#include <limits>
#include <algorithm>

using namespace emscripten;

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
// EMBIND
// ============================================================

EMSCRIPTEN_BINDINGS(sift_core)
{
    function("allocF64", &allocF64);
    function("freeF64", &freeF64);
    function("initHistogram", &initHistogram);
    function("processNextChunk", &processNextChunk);
    function("freeHistogram", &freeHistogram);
}