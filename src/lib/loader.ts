import Papa from "papaparse";
import * as XLSX from "xlsx";

/**
 * Результат парсинга: заголовки + строки данных + метаинформация о колонках
 */
export interface ParsedData {
  headers: string[];
  rows: (string | number | null | Date)[][];
  columnTypes: ColumnType[];
  rowCount: number;
  columnCount: number;
  fileName: string;
  hasHeaders: boolean;
  detectedHeaders: boolean;
  dropFirstRow: boolean;
  delimiter: string; // ← фактический разделитель
  delimiterAuto: boolean; // ← был ли автоопределён
  sourceFormat: "csv" | "xlsx" | "xls" | "unknown"; // ← тип источника
}

export interface ColumnType {
  name: string;
  type:
    | "numeric"
    | "string"
    | "mixed"
    | "empty"
    | "date"
    | "datetime"
    | "boolean"
    | "ordinal"; // Добавляем порядковый тип
  numericRatio: number; // доля числовых значений, 0..1
}
/**
 * Определяет формат файла по расширению
 */
function detectFormat(file: File): "csv" | "xlsx" | "xls" | "unknown" {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "tsv" || ext === "txt") return "csv";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  return "unknown";
}

export interface LoadOptions {
  hasHeaders?: boolean;
  dropFirstRow?: boolean;
  delimiter?: string | "auto"; // 'auto' или конкретный символ
}

export async function loadFile(
  file: File,
  options: LoadOptions = {},
): Promise<ParsedData> {
  const format = detectFormat(file);

  if (format === "csv") {
    return loadCSV(file, options);
  } else if (format === "xlsx" || format === "xls") {
    return loadExcel(file, options);
  }
  throw new Error(`Неподдерживаемый формат файла: ${file.name}`);
}

function loadCSV(file: File, options: LoadOptions): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const delimiterOption =
      options.delimiter && options.delimiter !== "auto"
        ? options.delimiter
        : ""; // пусто → Papa Parse определит сам

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false, // Отключаем, чтобы даты оставались строками и корректно определялись
      delimiter: delimiterOption,
      complete: (results) => {
        try {
          const allRows = results.data as (string | number | null)[][];

          // Papa Parse возвращает определённый разделитель в meta.delimiter
          const detectedDelimiter =
            (results.meta as { delimiter?: string }).delimiter ?? ",";

          resolve(
            buildParsedData(
              allRows,
              options,
              file.name,
              detectedDelimiter,
              !options.delimiter || options.delimiter === "auto", // delimiterAuto
              "csv",
            ),
          );
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => reject(err),
    });
  });
}

async function loadExcel(
  file: File,
  options: LoadOptions,
): Promise<ParsedData> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true }); // cellDates: true для парсинга дат
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const allRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as (string | number | null | Date)[][];

  return buildParsedData(
    allRows,
    options,
    file.name,
    "", // разделителя нет
    false,
    detectFormat(file) as "xlsx" | "xls",
  );
}

/**
 * Превращает массив строк в структурированный объект с типами
 */
function buildParsedData(
  allRows: (string | number | null | Date)[][],
  options: LoadOptions,
  fileName: string,
  delimiter: string,
  delimiterAuto: boolean,
  sourceFormat: "csv" | "xlsx" | "xls" | "unknown",
): ParsedData {
  if (allRows.length === 0) {
    return {
      headers: [],
      rows: [],
      columnTypes: [],
      rowCount: 0,
      columnCount: 0,
      fileName,
      hasHeaders: false,
      detectedHeaders: false,
      dropFirstRow: false,
      delimiter,
      delimiterAuto,
      sourceFormat,
    };
  }

  const detectedHeaders = detectHeaders(allRows);
  const finalHasHeaders = options.hasHeaders ?? detectedHeaders;
  const dropFirstRow = options.dropFirstRow ?? false;

  let headers: string[];
  let dataRows: (string | number | null | Date)[][];

  if (finalHasHeaders) {
    headers = allRows[0].map((h, i) =>
      h != null ? String(h) : `col_${i + 1}`,
    );
    dataRows = allRows.slice(1);
  } else if (dropFirstRow) {
    const colCount = allRows[0].length;
    headers = Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
    dataRows = allRows.slice(1);
  } else {
    const colCount = allRows[0].length;
    headers = Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
    dataRows = allRows;
  }

  const columnTypes = inferColumnTypes(headers, dataRows);

  return {
    headers,
    rows: dataRows,
    columnTypes,
    rowCount: dataRows.length,
    columnCount: headers.length,
    fileName,
    hasHeaders: finalHasHeaders,
    detectedHeaders,
    dropFirstRow: !finalHasHeaders && dropFirstRow,
    delimiter,
    delimiterAuto,
    sourceFormat,
  };
}

// ------------------------------------------------------------
// РЕГУЛЯРКИ И МНОЖЕСТВА ДЛЯ ОПРЕДЕЛЕНИЯ ТИПОВ
// ------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

const BOOL_TRUE = new Set(["true", "yes", "да"]);
const BOOL_FALSE = new Set(["false", "no", "нет"]);

function isDateString(s: string): boolean {
  return ISO_DATE_RE.test(s.trim());
}

function isDatetimeString(s: string): boolean {
  return ISO_DATETIME_RE.test(s.trim());
}

function isBooleanValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return true;
  const s = String(v).trim().toLowerCase();
  if (s === "") return false;
  return BOOL_TRUE.has(s) || BOOL_FALSE.has(s);
}

// ------------------------------------------------------------
// ОПРЕДЕЛЕНИЕ ТИПА КОЛОНКИ
// ------------------------------------------------------------
//
// Порядок проверок:
//   1. empty    — нет ни одного непустого значения
//   2. datetime — ISO с датой и временем
//   3. date     — ISO только с датой
//   4. boolean  — значения строго из {true, false, yes, no, да, нет}
//   5. numeric  — ≥80% значений парсятся как число
//   6. string   — ≤20% значений парсятся как число
//   7. mixed    — всё остальное
//
// Datetime проверяется ДО date, потому что datetime-строки не матчатся
// под ISO_DATE_RE (там есть `T`/пробел и время).
//
// Boolean проверяется ДО numeric, чтобы колонка "Yes/No" не считалась
// строковой. В то же время колонка из чистых 0/1 останется numeric:
// "0"/"1" в boolean-наборы не входят.

// ------------------------------------------------------------
// ОПРЕДЕЛЕНИЕ ПОРЯДКОВЫХ (ORDINAL) КОЛОНОК
// ------------------------------------------------------------
//
// Ordinal — категория, у которой есть естественный порядок
// (S < M < L, Bronze < Silver < Gold). Автоматически вывести порядок
// из произвольных строк невозможно, поэтому детектируем ordinal
// ТОЛЬКО через совпадение с известными словарями упорядоченных шкал.
// Всё остальное (регионы, города, имена) — обычная номинальная string.

const ORDINAL_VOCABULARIES: Set<string>[] = [
  // Размеры одежды / обуви
  new Set([
    "xs", "s", "m", "l", "xl", "xxl", "xxxl",
    "2xl", "3xl", "4xl", "5xl",
  ]),
  // Уровни лояльности / классы обслуживания
  new Set(["bronze", "silver", "gold", "platinum", "diamond", "titanium"]),
  // Уровни (англ.)
  new Set([
    "very low", "low", "medium", "high", "very high",
  ]),
  // Уровни (рус.)
  new Set([
    "очень низкий", "низкий", "средний", "высокий", "очень высокий",
  ]),
  // Оценки (англ.)
  new Set(["very bad", "bad", "neutral", "good", "very good"]),
  // Оценки (рус.)
  new Set([
    "очень плохо", "плохо", "нейтрально", "удовлетворительно",
    "хорошо", "отлично",
  ]),
  // Уровни образования
  new Set([
    "primary", "secondary", "bachelor", "master", "phd", "doctorate",
  ]),
  new Set([
    "начальное", "среднее", "среднее специальное", "высшее",
    "бакалавриат", "магистратура", "аспирантура",
  ]),
  // Грейды
  new Set(["intern", "junior", "middle", "senior", "lead", "principal"]),
  // Частота использования
  new Set(["never", "rarely", "sometimes", "often", "always"]),
  new Set(["никогда", "редко", "иногда", "часто", "всегда"]),
];

/**
 * Проверяет, является ли набор строковых значений порядковой шкалой.
 * Условия:
 *   1. Уникальных значений не больше 15 (иначе — не шкала).
 *   2. Все уникальные значения целиком укладываются в один из словарей.
 * Если хотя бы одно значение не входит в словарь — это не ordinal.
 */
function isOrdinalString(values: string[]): boolean {
  const uniq = new Set(
    values
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v !== ""),
  );
  if (uniq.size === 0 || uniq.size > 15) return false;

  for (const vocab of ORDINAL_VOCABULARIES) {
    let allMatch = true;
    for (const v of uniq) {
      if (!vocab.has(v)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}

function inferColumnTypes(
  headers: string[],
  rows: (string | number | null | Date)[][],
): ColumnType[] {
  return headers.map((name, colIdx) => {
    let numericCount = 0;
    let dateCount = 0;
    let datetimeCount = 0;
    let booleanCount = 0;
    let totalNonEmpty = 0;

    for (const row of rows) {
      const val = row[colIdx];
      if (val === null || val === undefined || val === "") continue;

      totalNonEmpty++;

      // --- Обработка объектов Date (для Excel) ---
      if (val instanceof Date) {
        if (val.getHours() !== 0 || val.getMinutes() !== 0 || val.getSeconds() !== 0) {
          datetimeCount++;
        } else {
          dateCount++;
        }
        continue; // Пропускаем остальные проверки для этого значения
      }

      // --- числовое ---
      if (typeof val === "number" && !isNaN(val)) {
        numericCount++;
      } else if (typeof val === "string") {
        const num = Number(val.replace(",", "."));
        if (!isNaN(num) && val.trim() !== "") {
          numericCount++;
        }
      }

      // --- datetime / date (для строк CSV) ---
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (isDatetimeString(trimmed)) {
          datetimeCount++;
        } else if (isDateString(trimmed)) {
          dateCount++;
        }
      }

      // --- boolean ---
      if (isBooleanValue(val)) booleanCount++;
    }

    const ratio = totalNonEmpty > 0 ? numericCount / totalNonEmpty : 0;
    const dtRatio = totalNonEmpty > 0 ? datetimeCount / totalNonEmpty : 0;
    const dRatio = totalNonEmpty > 0 ? dateCount / totalNonEmpty : 0;
    const boolRatio = totalNonEmpty > 0 ? booleanCount / totalNonEmpty : 0;

    let type: ColumnType["type"];
    if (totalNonEmpty === 0) type = "empty";
    else if (dtRatio >= 0.8) type = "datetime";
    else if (dRatio >= 0.8) type = "date";
    else if (boolRatio >= 0.95) type = "boolean";
    else if (ratio >= 0.8) type = "numeric";
    else if (ratio <= 0.2) {
      // Ordinal — только если значения совпали с известной шкалой.
      // Иначе — обычная номинальная строка.
      const stringValues = rows
        .map((r) => r[colIdx])
        .filter((v): v is string => typeof v === "string" && v.trim() !== "");
      type = isOrdinalString(stringValues) ? "ordinal" : "string";
    } else type = "mixed";

    return { name, type, numericRatio: ratio };
  });
}

/**
 * Проверяет, является ли значение числом.
 */
function isNumericValue(val: string | number | null | Date): boolean {
  if (val === null || val === undefined || val === "") return false;
  if (val instanceof Date) return false; // дата — не число
  if (typeof val === "number") return !isNaN(val);
  const trimmed = val.trim();
  if (trimmed === "") return false;
  const num = Number(trimmed.replace(",", "."));
  return !isNaN(num);
}

/**
 * Определяет, является ли первая строка заголовками.
 * Эвристика: первая строка текстовая + в данных есть числовые колонки.
 */
export function detectHeaders(
  allRows: (string | number | null | Date)[][],
): boolean {
  if (allRows.length < 2) return false;

  const firstRow = allRows[0];
  const dataRows = allRows.slice(1);

  // Признак 1: первая строка преимущественно текстовая
  const nonEmptyFirst = firstRow.filter(
    (v) => v !== null && v !== undefined && String(v).trim() !== "",
  );
  if (nonEmptyFirst.length === 0) return false;

  const textualInFirst = nonEmptyFirst.filter((v) => !isNumericValue(v)).length;
  const firstRowIsTextual = textualInFirst / nonEmptyFirst.length >= 0.7;
  if (!firstRowIsTextual) return false;

  // Признак 2: есть хотя бы одна числовая колонка в данных
  let numericColumns = 0;
  for (let col = 0; col < firstRow.length; col++) {
    let numericInData = 0;
    let totalInData = 0;

    for (const row of dataRows) {
      const val = row[col];
      if (val === null || val === undefined || val === "") continue;
      totalInData++;
      if (isNumericValue(val)) numericInData++;
    }

    if (totalInData > 0 && numericInData / totalInData >= 0.8) {
      numericColumns++;
    }
  }

  return numericColumns >= 1;
}
