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
    double v2);

// ============================================================
// СОСТОЯНИЕ ПРОГРЕССИВНОГО АГРЕГАТОРА (ГИСТОГРАММА)
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
        if (v < minV)
        {
            idx = 0;
        }
        else if (v > st->maxValue)
        {
            idx = bins + 1;
        }
        else
        {
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

struct BarChartState
{
    const int32_t *catIndices = nullptr;
    const double *values = nullptr;
    unsigned int length = 0;
    unsigned int numCategories = 0;
    bool hasValues = false;

    std::vector<double> acc;
    unsigned int processed = 0;
};

unsigned int allocI32(unsigned int count)
{
    int32_t *p = new int32_t[count];
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(p));
}

void freeI32(unsigned int ptr)
{
    int32_t *p = reinterpret_cast<int32_t *>(static_cast<uintptr_t>(ptr));
    delete[] p;
}

unsigned int initBarChart(
    unsigned int catIndicesPtr,
    unsigned int valuesPtr,
    unsigned int length,
    unsigned int numCategories)
{
    auto *st = new BarChartState();
    st->catIndices = reinterpret_cast<const int32_t *>(
        static_cast<uintptr_t>(catIndicesPtr));
    st->values = valuesPtr
                     ? reinterpret_cast<const double *>(static_cast<uintptr_t>(valuesPtr))
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
    unsigned int elements)
{
    auto *st = reinterpret_cast<BarChartState *>(static_cast<uintptr_t>(handle));
    if (!st)
        return emscripten::val::null();

    const unsigned int start = st->processed;
    const unsigned int end = std::min(start + elements, st->length);

    const int32_t *cats = st->catIndices;
    const double *vals = st->values;
    const unsigned int nCats = st->numCategories;
    const bool useVals = st->hasValues;

    for (unsigned int i = start; i < end; ++i)
    {
        int32_t cat = cats[i];
        if (cat < 0 || static_cast<unsigned int>(cat) >= nCats)
            continue;

        if (useVals)
        {
            double v = vals[i];
            if (std::isnan(v))
                continue;
            st->acc[cat] += v;
        }
        else
        {
            st->acc[cat] += 1.0;
        }
    }

    st->processed = end;

    emscripten::val jsValues = emscripten::val::array();
    for (unsigned int i = 0; i < nCats; ++i)
    {
        jsValues.call<void>("push", st->acc[i]);
    }

    emscripten::val result = emscripten::val::object();
    result.set("processed", static_cast<double>(st->processed));
    result.set("total", static_cast<double>(st->length));
    result.set("categories", static_cast<double>(nCats));
    result.set("values", jsValues);
    result.set("done", st->processed >= st->length);
    return result;
}

void freeBarChart(unsigned int handle)
{
    auto *st = reinterpret_cast<BarChartState *>(static_cast<uintptr_t>(handle));
    delete st;
}

// ============================================================
// ГРУППИРОВАННАЯ ГИСТОГРАММА (BUCKETED, 2D)
// ============================================================
//
// Аналог bucketed histogram, но counts — 2D-матрица
// [bucket][category]. Размер = numBuckets * numCategories.

struct GroupedHistogramState
{
    const double *data = nullptr;
    const int32_t *catIndices = nullptr;
    unsigned int length = 0;

    const int32_t *ops = nullptr;
    const double *v1s = nullptr;
    const double *v2s = nullptr;
    unsigned int numBuckets = 0;
    unsigned int numCategories = 0;

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
    unsigned int numCategories)
{
    if (numBuckets == 0)
        numBuckets = 1;
    if (numCategories == 0)
        numCategories = 1;

    auto *st = new GroupedHistogramState();
    st->data = reinterpret_cast<const double *>(static_cast<uintptr_t>(dataPtr));
    st->catIndices = reinterpret_cast<const int32_t *>(static_cast<uintptr_t>(catIndicesPtr));
    st->length = length;
    st->ops = reinterpret_cast<const int32_t *>(static_cast<uintptr_t>(opsPtr));
    st->v1s = reinterpret_cast<const double *>(static_cast<uintptr_t>(v1Ptr));
    st->v2s = reinterpret_cast<const double *>(static_cast<uintptr_t>(v2Ptr));
    st->numBuckets = numBuckets;
    st->numCategories = numCategories;
    st->counts.assign(numBuckets * numCategories, 0);
    st->outOfBuckets = 0;
    st->processed = 0;
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(st));
}

emscripten::val processGroupedHistogramChunk(
    unsigned int handle,
    unsigned int elements)
{
    auto *st = reinterpret_cast<GroupedHistogramState *>(static_cast<uintptr_t>(handle));
    if (!st)
        return emscripten::val::null();

    const unsigned int start = st->processed;
    const unsigned int end = std::min(start + elements, st->length);

    const unsigned int nB = st->numBuckets;
    const unsigned int nC = st->numCategories;
    const int32_t *ops = st->ops;
    const double *v1s = st->v1s;
    const double *v2s = st->v2s;

    for (unsigned int i = start; i < end; ++i)
    {
        double v = st->data[i];
        if (std::isnan(v))
            continue;

        int32_t cat = st->catIndices[i];
        if (cat < 0 || static_cast<unsigned int>(cat) >= nC)
            continue;

        // Первое совпадение выигрывает
        bool matched = false;
        for (unsigned int b = 0; b < nB; ++b)
        {
            if (bucketMatches(v, ops[b], v1s[b], v2s[b]))
            {
                st->counts[b * nC + cat] += 1;
                matched = true;
                break;
            }
        }
        if (!matched)
            st->outOfBuckets += 1;
    }

    st->processed = end;

    emscripten::val jsCounts = emscripten::val::array();
    for (size_t i = 0; i < st->counts.size(); ++i)
    {
        jsCounts.call<void>("push", st->counts[i]);
    }

    emscripten::val result = emscripten::val::object();
    result.set("processed", static_cast<double>(st->processed));
    result.set("total", static_cast<double>(st->length));
    result.set("numBuckets", static_cast<double>(nB));
    result.set("numCategories", static_cast<double>(nC));
    result.set("counts", jsCounts);
    result.set("outOfBuckets", static_cast<double>(st->outOfBuckets));
    result.set("done", st->processed >= st->length);
    return result;
}

void freeGroupedHistogram(unsigned int handle)
{
    auto *st = reinterpret_cast<GroupedHistogramState *>(static_cast<uintptr_t>(handle));
    delete st;
}

// ============================================================
// ГИСТОГРАММА С ПРОИЗВОЛЬНЫМИ ГРУППАМИ (BUCKETED HISTOGRAM)
// ============================================================
//
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

struct BucketedHistogramState
{
    const double *data = nullptr;
    unsigned int length = 0;
    unsigned int numBuckets = 0;

    const int32_t *ops = nullptr;
    const double *v1s = nullptr;
    const double *v2s = nullptr;

    std::vector<uint32_t> counts;
    unsigned int outOfBuckets = 0;
    unsigned int processed = 0;
};

static inline bool bucketMatches(
    double v,
    int32_t op,
    double v1,
    double v2)
{
    switch (op)
    {
    case 0:
        return v < v1;
    case 1:
        return v <= v1;
    case 2:
        return v > v1;
    case 3:
        return v >= v1;
    case 4:
        return v == v1;
    case 5:
        return v != v1;
    case 6:
        return v >= v1 && v <= v2;
    default:
        return false; // op == -1 или неизвестный
    }
}

unsigned int initBucketedHistogram(
    unsigned int dataPtr,
    unsigned int length,
    unsigned int opsPtr,
    unsigned int v1Ptr,
    unsigned int v2Ptr,
    unsigned int numBuckets)
{
    auto *st = new BucketedHistogramState();
    st->data = reinterpret_cast<const double *>(static_cast<uintptr_t>(dataPtr));
    st->length = length;
    st->numBuckets = numBuckets;
    st->ops = reinterpret_cast<const int32_t *>(static_cast<uintptr_t>(opsPtr));
    st->v1s = reinterpret_cast<const double *>(static_cast<uintptr_t>(v1Ptr));
    st->v2s = reinterpret_cast<const double *>(static_cast<uintptr_t>(v2Ptr));
    st->counts.assign(numBuckets, 0);
    st->outOfBuckets = 0;
    st->processed = 0;
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(st));
}

emscripten::val processBucketedHistogramChunk(
    unsigned int handle,
    unsigned int elements)
{
    auto *st = reinterpret_cast<BucketedHistogramState *>(static_cast<uintptr_t>(handle));
    if (!st)
        return emscripten::val::null();

    const unsigned int start = st->processed;
    const unsigned int end = std::min(start + elements, st->length);
    const unsigned int nB = st->numBuckets;
    const int32_t *ops = st->ops;
    const double *v1s = st->v1s;
    const double *v2s = st->v2s;

    for (unsigned int i = start; i < end; ++i)
    {
        double v = st->data[i];
        if (std::isnan(v))
            continue;

        bool matched = false;
        for (unsigned int b = 0; b < nB; ++b)
        {
            if (bucketMatches(v, ops[b], v1s[b], v2s[b]))
            {
                st->counts[b] += 1;
                matched = true;
                break; // первое совпадение выигрывает
            }
        }
        if (!matched)
            st->outOfBuckets += 1;
    }

    st->processed = end;

    emscripten::val jsCounts = emscripten::val::array();
    for (unsigned int i = 0; i < nB; ++i)
    {
        jsCounts.call<void>("push", st->counts[i]);
    }

    emscripten::val result = emscripten::val::object();
    result.set("processed", static_cast<double>(st->processed));
    result.set("total", static_cast<double>(st->length));
    result.set("buckets", static_cast<double>(nB));
    result.set("counts", jsCounts);
    result.set("outOfBuckets", static_cast<double>(st->outOfBuckets));
    result.set("done", st->processed >= st->length);
    return result;
}

void freeBucketedHistogram(unsigned int handle)
{
    auto *st = reinterpret_cast<BucketedHistogramState *>(static_cast<uintptr_t>(handle));
    delete st;
}

// ============================================================
// P²-АЛГОРИТМ ДЛЯ ПРОГРЕССИВНОЙ ОЦЕНКИ КВАРТИЛЕЙ
// ============================================================
//
// Источник: Jain & Chlamtac, "The P² Algorithm for Dynamic
// Calculation of Quantiles and Histograms Without Storing
// Observations", Communications of the ACM, 1985.
//
// 5 маркеров, которые двигаются по мере поступления данных,
// аппроксимируя целевой квантиль. Оценка = высота q[2].
//
// Для box plot запускаем 3 экземпляра:
//   p = 0.25 → Q1
//   p = 0.50 → медиана
//   p = 0.75 → Q3

struct P2Marker
{
    double q[5];      // высоты маркеров
    double n[5];      // реальные позиции маркеров
    double nPrime[5]; // желаемые позиции
    double p;         // целевой квантиль (0..1)
    int64_t count;    // сколько значений обработано
    bool initialized;
    double seedBuf[5]; // буфер для первых 5 значений
    int seedCount;

    void reset(double quantile)
    {
        p = quantile;
        count = 0;
        initialized = false;
        seedCount = 0;
    }

    void seed(double x)
    {
        seedBuf[seedCount++] = x;
        if (seedCount < 5)
            return;

        // сортировка вставками 5 элементов
        for (int i = 1; i < 5; ++i)
        {
            double v = seedBuf[i];
            int j = i - 1;
            while (j >= 0 && seedBuf[j] > v)
            {
                seedBuf[j + 1] = seedBuf[j];
                --j;
            }
            seedBuf[j + 1] = v;
        }

        for (int i = 0; i < 5; ++i)
        {
            q[i] = seedBuf[i];
            n[i] = static_cast<double>(i);
        }
        nPrime[0] = 0.0;
        nPrime[1] = 1.0 + 2.0 * p;
        nPrime[2] = 1.0 + 4.0 * p;
        nPrime[3] = 1.0 + 6.0 * p;
        nPrime[4] = 4.0;

        count = 5;
        initialized = true;
    }

    void step(double x)
    {
        // 1. Найти k: q[k] <= x < q[k+1]
        int k;
        if (x < q[0])
        {
            q[0] = x;
            k = 0;
        }
        else if (x >= q[4])
        {
            q[4] = x;
            k = 3;
        }
        else
        {
            k = 0;
            while (k < 4 && x >= q[k + 1])
                ++k;
        }

        // 2. Сдвинуть позиции маркеров k+1 .. 4 вправо
        for (int i = k + 1; i < 5; ++i)
            n[i] += 1.0;

        // --- 3. Обновить желаемые позиции ---
        //
        // Каждый маркер растёт со своей скоростью согласно
        // каноническому P² (Jain & Chlamtac, 1985):
        //   nPrime[1] += p/2       — тянется к p-квантилю снизу
        //   nPrime[2] += p         — тянется к p-квантилю в центре
        //   nPrime[3] += (1+p)/2   — тянется к p-квантилю сверху
        //   nPrime[4] = count+1    — всегда максимум
        nPrime[1] += p / 2.0;
        nPrime[2] += p;
        nPrime[3] += (1.0 + p) / 2.0;
        nPrime[4] = static_cast<double>(count + 1);

        // 4. Подтянуть внутренние маркеры 1..3
        for (int i = 1; i <= 3; ++i)
        {
            double d = nPrime[i] - n[i];

            const bool moveRight =
                d >= 1.0 && (n[i + 1] - n[i]) > 1.0;
            const bool moveLeft =
                d <= -1.0 && (n[i - 1] - n[i]) < -1.0;

            if (!moveRight && !moveLeft)
                continue;

            int sign = (d > 0) ? 1 : -1;

            double qNew = q[i] +
                          (static_cast<double>(sign) / (n[i + 1] - n[i - 1])) *
                              ((n[i] - n[i - 1] + sign) * (q[i + 1] - q[i]) /
                                   (n[i + 1] - n[i]) +
                               (n[i + 1] - n[i] - sign) * (q[i] - q[i - 1]) /
                                   (n[i] - n[i - 1]));

            if (qNew > q[i - 1] && qNew < q[i + 1])
            {
                q[i] = qNew;
            }
            else
            {
                q[i] += static_cast<double>(sign) *
                        (q[i + sign] - q[i]) / (n[i + sign] - n[i]);
            }
            n[i] += static_cast<double>(sign);
        }

        count += 1;
    }

    void add(double x)
    {
        if (!initialized)
        {
            seed(x);
            return;
        }
        step(x);
    }

    double estimate() const { return q[2]; }
};

// ============================================================
// СОСТОЯНИЕ BOX PLOT
// ============================================================
//
// 3 P²-маркера (Q1, медиана, Q3) + min/max + count.
// ~136 байт на диаграмму.

// Ограничение на число выбросов, которые реально кладём в массив.
// Если в данных их больше — счётчик сохранит полное число, а в JS
// уйдёт только первые MAX_OUTLIERS значений. Этого хватает визуально.
static const int MAX_OUTLIERS = 500;

struct BoxPlotState {
    const double* data = nullptr;
    unsigned int  length = 0;
    unsigned int  processed = 0;

    P2Marker q1;
    P2Marker median;
    P2Marker q3;
    double minVal;
    double maxVal;
    int64_t count;

    // --- Границы усов (1.5·IQR) и выбросы ---
    double upperFence = 0.0;
    double lowerFence = 0.0;
    std::vector<double> upperOutliers;
    std::vector<double> lowerOutliers;
    int64_t upperOutlierCount = 0;
    int64_t lowerOutlierCount = 0;
    bool outliersComputed = false;

    BoxPlotState() {
        q1.reset(0.25);
        median.reset(0.50);
        q3.reset(0.75);
        minVal = +1e300;
        maxVal = -1e300;
        count = 0;
    }

    void updateRange(const double* d, unsigned int len) {
        for (unsigned int i = 0; i < len; ++i) {
            double v = d[i];
            if (!std::isfinite(v)) continue;

            q1.add(v);
            median.add(v);
            q3.add(v);

            if (v < minVal) minVal = v;
            if (v > maxVal) maxVal = v;
            count += 1;
        }
    }

    // Финальный проход по всему массиву: определяем fences по
    // текущим Q1/Q3 и собираем выбросы. Делаем один раз на done.
    void computeOutliers() {
        const double q1v = q1.estimate();
        const double q3v = q3.estimate();
        const double iqr  = q3v - q1v;

        upperFence = q3v + 1.5 * iqr;
        lowerFence = q1v - 1.5 * iqr;

        for (unsigned int i = 0; i < length; ++i) {
            double v = data[i];
            if (!std::isfinite(v)) continue;

            if (v > upperFence) {
                upperOutlierCount++;
                if ((int)upperOutliers.size() < MAX_OUTLIERS) {
                    upperOutliers.push_back(v);
                }
            } else if (v < lowerFence) {
                lowerOutlierCount++;
                if ((int)lowerOutliers.size() < MAX_OUTLIERS) {
                    lowerOutliers.push_back(v);
                }
            }
        }
    }
};

unsigned int initBoxPlot(
    unsigned int dataPtr,
    unsigned int length)
{
    auto *st = new BoxPlotState();
    st->data = reinterpret_cast<const double *>(static_cast<uintptr_t>(dataPtr));
    st->length = length;
    st->processed = 0;
    return static_cast<unsigned int>(reinterpret_cast<uintptr_t>(st));
}

emscripten::val processBoxPlotChunk(
    unsigned int handle,
    unsigned int elements)
{
    auto *st = reinterpret_cast<BoxPlotState *>(static_cast<uintptr_t>(handle));
    if (!st)
        return emscripten::val::null();

    const unsigned int start = st->processed;
    const unsigned int end = std::min(start + elements, st->length);
    st->updateRange(st->data + start, end - start);
    st->processed = end;

    // Когда всё обработано — один раз обходим массив и считаем выбросы.
    if (st->processed >= st->length && !st->outliersComputed) {
        st->computeOutliers();
        st->outliersComputed = true;
    }

    const double q1v = st->q1.estimate();
    const double medv = st->median.estimate();
    const double q3v = st->q3.estimate();
    const double iqr = q3v - q1v;

    emscripten::val result = emscripten::val::object();
    result.set("processed", static_cast<double>(st->processed));
    result.set("total",     static_cast<double>(st->length));
    result.set("q1",        q1v);
    result.set("median",    medv);
    result.set("q3",        q3v);
    result.set("iqr",       iqr);
    result.set("min",       (st->minVal < +1e300) ? st->minVal : 0.0);
    result.set("max",       (st->maxVal > -1e300) ? st->maxVal : 0.0);
    result.set("count",     static_cast<double>(st->count));
    result.set("done",      st->processed >= st->length);

    // Границы усов и выбросы (валидны после done)
    result.set("upperFence", st->upperFence);
    result.set("lowerFence", st->lowerFence);
    result.set("upperOutlierCount", static_cast<double>(st->upperOutlierCount));
    result.set("lowerOutlierCount", static_cast<double>(st->lowerOutlierCount));

    emscripten::val upperArr = emscripten::val::array();
    for (double v : st->upperOutliers) upperArr.call<void>("push", v);
    result.set("upperOutliers", upperArr);

    emscripten::val lowerArr = emscripten::val::array();
    for (double v : st->lowerOutliers) lowerArr.call<void>("push", v);
    result.set("lowerOutliers", lowerArr);

    return result;
}

void freeBoxPlot(unsigned int handle)
{
    auto *st = reinterpret_cast<BoxPlotState *>(static_cast<uintptr_t>(handle));
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
    function("allocI32", &allocI32);
    function("freeI32", &freeI32);
    function("initBarChart", &initBarChart);
    function("processBarChartChunk", &processBarChartChunk);
    function("freeBarChart", &freeBarChart);
    function("initBucketedHistogram", &initBucketedHistogram);
    function("processBucketedHistogramChunk", &processBucketedHistogramChunk);
    function("freeBucketedHistogram", &freeBucketedHistogram);
    function("initGroupedHistogram", &initGroupedHistogram);
    function("processGroupedHistogramChunk", &processGroupedHistogramChunk);
    function("freeGroupedHistogram", &freeGroupedHistogram);

    // Box plot (P²)
    function("initBoxPlot", &initBoxPlot);
    function("processBoxPlotChunk", &processBoxPlotChunk);
    function("freeBoxPlot", &freeBoxPlot);
}