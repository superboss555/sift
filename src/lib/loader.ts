import Papa from "papaparse";
import * as XLSX from "xlsx";

/**
 * Результат парсинга: заголовки + строки данных + метаинформация о колонках
 */
export interface ParsedData {
  headers: string[];
  rows: (string | number | null)[][];
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
  type: "numeric" | "string" | "mixed" | "empty";
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
      dynamicTyping: true,
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
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const allRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as (string | number | null)[][];

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
  allRows: (string | number | null)[][],
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
  let dataRows: (string | number | null)[][];

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

/**
 * Определяет тип каждой колонки: numeric / string / mixed / empty
 */
function inferColumnTypes(
  headers: string[],
  rows: (string | number | null)[][],
): ColumnType[] {
  return headers.map((name, colIdx) => {
    let numericCount = 0;
    let totalNonEmpty = 0;

    for (const row of rows) {
      const val = row[colIdx];
      if (val === null || val === undefined || val === "") continue;

      totalNonEmpty++;

      // Проверка на число
      if (typeof val === "number" && !isNaN(val)) {
        numericCount++;
      } else if (typeof val === "string") {
        const num = Number(val.replace(",", "."));
        if (!isNaN(num) && val.trim() !== "") {
          numericCount++;
        }
      }
    }

    const ratio = totalNonEmpty > 0 ? numericCount / totalNonEmpty : 0;

    let type: ColumnType["type"];
    if (totalNonEmpty === 0) type = "empty";
    else if (ratio >= 0.8) type = "numeric";
    else if (ratio <= 0.2) type = "string";
    else type = "mixed";

    return { name, type, numericRatio: ratio };
  });
}

/**
 * Проверяет, является ли значение числом.
 */
function isNumericValue(val: string | number | null): boolean {
  if (val === null || val === undefined || val === "") return false;
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
export function detectHeaders(allRows: (string | number | null)[][]): boolean {
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
