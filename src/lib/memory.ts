import type { ParsedData } from './loader.js';

export interface MemoryStats {
    fileSize: number;
    parsedSize: number;
    heapUsed: number;
    heapLimit: number;
    numericCompactSize: number;
}

/**
 * Оценивает размер ParsedData в памяти.
 * Грубая оценка: строки + числа + оверхед массивов.
 */
function estimateParsedSize(data: ParsedData): number {
    const OVERHEAD_PER_ARRAY = 32;    // заголовок JS-массива
    const OVERHEAD_PER_STRING = 40;   // заголовок JS-строки
    const OVERHEAD_PER_NUMBER = 8;    // число в JS
    const OVERHEAD_PER_NULL = 4;

    let bytes = 0;

    // Заголовки
    bytes += OVERHEAD_PER_ARRAY + data.headers.length * OVERHEAD_PER_STRING;
    for (const h of data.headers) bytes += h.length * 2; // UTF-16

    // Строки данных
    bytes += OVERHEAD_PER_ARRAY * data.rows.length;
    for (const row of data.rows) {
        bytes += OVERHEAD_PER_ARRAY + row.length * OVERHEAD_PER_NUMBER;
        for (const cell of row) {
            if (cell === null || cell === undefined) bytes += OVERHEAD_PER_NULL;
            else if (typeof cell === 'string') {
                bytes += OVERHEAD_PER_STRING + cell.length * 2;
            } else {
                bytes += OVERHEAD_PER_NUMBER;
            }
        }
    }

    return bytes;
}

/**
 * Оценивает размер только числовых колонок в Float64Array.
 * Показывает потенциал сжатия данных при передаче в WASM.
 */
function estimateNumericCompact(data: ParsedData): number {
    const numericCols = data.columnTypes.filter((c) => c.type === 'numeric').length;
    return numericCols * data.rowCount * 8; // Float64 = 8 байт на значение
}

/**
 * Собирает статистику памяти.
 */
export function collectMemoryStats(
    file: File,
    data: ParsedData,
): MemoryStats {
    const perf = (performance as unknown) as {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    };

    return {
        fileSize: file.size,
        parsedSize: estimateParsedSize(data),
        heapUsed: perf.memory?.usedJSHeapSize ?? 0,
        heapLimit: perf.memory?.jsHeapSizeLimit ?? 0,
        numericCompactSize: estimateNumericCompact(data),
    };
}

/**
 * Форматирует байты в человеко-читаемый вид.
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}