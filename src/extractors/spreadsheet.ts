import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { AppError } from "../errors.js";
import type { AppConfig } from "../config.js";
import type { SecureFile } from "../security/path-guard.js";
import { cleanText, normalizeSearchText } from "../utils/text.js";
import { inspectOfficeArchive } from "../security/zip-guard.js";
import { decodeCsvBuffer, parseCsvBuffer } from "./csv.js";
export { decodeCsvBuffer, parseCsvBuffer } from "./csv.js";
import type { ParsedCsv } from "./csv.js";

export interface SpreadsheetTable {
  sheetName: string;
  markdown: string;
  json: string;
  rowsReturned: number;
  totalRows: number;
  columnsReturned: number;
  totalColumns: number;
  truncated: boolean;
}
export interface SpreadsheetSearchUnit { location: string; text: string; }
export interface SpreadsheetSearchResult { units: SpreadsheetSearchUnit[]; warnings: string[]; }

export function csvToTable(parsed: ParsedCsv, maxRows: number, maxColumns: number): SpreadsheetTable {
  const matrix = parsed.rows.slice(0, maxRows).map((row) => row.slice(0, maxColumns));
  const totalRows = parsed.totalRows;
  const totalColumns = parsed.totalColumns;
  const columnsReturned = Math.min(totalColumns, maxColumns);
  if (matrix.length === 0 || columnsReturned === 0) {
    return { sheetName: "CSV", markdown: "_(CSV kosong)_", json: JSON.stringify({ sheetName: "CSV", columns: [], rows: [] }, null, 2), rowsReturned: 0, totalRows, columnsReturned: 0, totalColumns, truncated: totalRows > maxRows || totalColumns > maxColumns };
  }
  const headers = makeUniqueHeaders((matrix[0] ?? []).map((value) => value ?? ""), columnsReturned);
  const records = matrix.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
  const markdown = [
    `| ${headers.map(escapeMarkdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...matrix.slice(1).map((row) => `| ${headers.map((_, index) => escapeMarkdownCell(row[index] ?? "")).join(" | ")} |`),
  ].join("\n");
  return {
    sheetName: "CSV", markdown,
    json: JSON.stringify({ sheetName: "CSV", columns: headers, rows: records, rowsReturned: records.length, totalRows }, null, 2),
    rowsReturned: matrix.length, totalRows, columnsReturned, totalColumns,
    truncated: totalRows > maxRows || totalColumns > maxColumns,
  };
}

export function searchCsvBuffer(buffer: Buffer, query: string, maxRows: number, maxColumns: number, maxResults: number): SpreadsheetSearchResult {
  const parsed = parseCsvBuffer(buffer, maxRows, maxColumns);
  const terms = [...new Set(normalizeSearchText(query).split(/\s+/).filter(Boolean))];
  const units: SpreadsheetSearchUnit[] = [];
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index]!;
    const text = row.join(" | ");
    const normalized = normalizeSearchText(text);
    if (terms.length > 0 && terms.every((term) => normalized.includes(term))) {
      units.push({ location: `CSV, baris ${index + 1}`, text });
      if (units.length >= maxResults) break;
    }
  }
  const warnings: string[] = [];
  if (parsed.totalRows > maxRows) warnings.push(`Pencarian CSV dibatasi hingga ${maxRows} baris.`);
  if (parsed.totalColumns > maxColumns) warnings.push(`Pencarian CSV dibatasi hingga ${maxColumns} kolom.`);
  return { units: units.slice(0, maxResults), warnings };
}

export function cellToValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return typeof value === "string" ? cleanText(value) : value;
  if ("richText" in value && Array.isArray(value.richText)) return cleanText(value.richText.map((part: { text: string }) => part.text).join(""));
  if ("hyperlink" in value && typeof value.hyperlink === "string") return cleanText(typeof value.text === "string" ? value.text : value.hyperlink);
  if ("result" in value && value.result !== undefined) return cellToValue(value.result as ExcelJS.CellValue);
  if ("formula" in value && typeof value.formula === "string") return `=${cleanText(value.formula)}`;
  if ("sharedFormula" in value && typeof value.sharedFormula === "string") return `=${cleanText(value.sharedFormula)}`;
  if ("error" in value && typeof value.error === "string") return cleanText(value.error);
  if ("text" in value && typeof value.text === "string") return cleanText(value.text);
  return "[Nilai sel kompleks]";
}

export function cellToText(value: ExcelJS.CellValue): string {
  const normalized = cellToValue(value);
  return normalized === null ? "" : cleanText(normalized);
}

export async function loadWorkbook(file: SecureFile, buffer: Buffer, config: AppConfig): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    if (file.extension === ".xlsx") {
      inspectOfficeArchive(buffer, config, "xlsx");
      await workbook.xlsx.load(buffer as never);
      return workbook;
    }
    if (file.extension === ".csv") {
      await workbook.csv.read(Readable.from([decodeCsvBuffer(buffer)]));
      return workbook;
    }
    throw new AppError("UNSUPPORTED_FILE_TYPE", "Hanya XLSX dan CSV yang didukung untuk pembacaan spreadsheet.");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("SPREADSHEET_PARSE_FAILED", "Spreadsheet gagal diproses. Pastikan XLSX/CSV valid, tidak rusak, dan tidak melebihi batas kompleksitas.");
  }
}

function escapeMarkdownCell(value: string): string {
  return cleanText(value).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function makeUniqueHeaders(rawHeaders: string[], width: number): string[] {
  const used = new Map<string, number>();
  return Array.from({ length: width }, (_, index) => {
    const base = cleanText(rawHeaders[index] ?? "").trim() || `Kolom_${index + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

export function worksheetToTable(worksheet: ExcelJS.Worksheet, maxRows: number, maxColumns: number): SpreadsheetTable {
  const totalRows = worksheet.rowCount;
  const totalColumns = worksheet.columnCount;
  const rowsReturned = Math.min(totalRows, maxRows);
  const columnsReturned = Math.min(totalColumns, maxColumns);
  if (rowsReturned === 0 || columnsReturned === 0) {
    return {
      sheetName: worksheet.name, markdown: "_(Sheet kosong)_",
      json: JSON.stringify({ sheetName: worksheet.name, columns: [], rows: [] }, null, 2),
      rowsReturned: 0, totalRows, columnsReturned: 0, totalColumns, truncated: false,
    };
  }

  const matrix: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= rowsReturned; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    matrix.push(Array.from({ length: columnsReturned }, (_, columnIndex) => cellToValue(row.getCell(columnIndex + 1).value)));
  }
  const headers = makeUniqueHeaders((matrix[0] ?? []).map((value) => value === null ? "" : String(value)), columnsReturned);
  const records = matrix.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
  const markdownHeader = headers.map(escapeMarkdownCell);
  const markdownRows = matrix.slice(1).map((row) => row.map((value) => escapeMarkdownCell(value === null ? "" : String(value))));
  const markdown = [
    `| ${markdownHeader.join(" | ")} |`,
    `| ${markdownHeader.map(() => "---").join(" | ")} |`,
    ...markdownRows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
  return {
    sheetName: worksheet.name, markdown,
    json: JSON.stringify({ sheetName: worksheet.name, columns: headers, rows: records, rowsReturned: records.length, totalRows }, null, 2),
    rowsReturned: matrix.length, totalRows, columnsReturned, totalColumns,
    truncated: totalRows > maxRows || totalColumns > maxColumns,
  };
}

export function searchWorksheet(
  worksheet: ExcelJS.Worksheet,
  query: string,
  maxRows: number,
  maxColumns: number,
  maxResults: number,
): SpreadsheetSearchResult {
  const rowLimit = Math.min(worksheet.rowCount, maxRows);
  const columnLimit = Math.min(worksheet.columnCount, maxColumns);
  const units: SpreadsheetSearchUnit[] = [];
  const needle = normalizeSearchText(query);
  const terms = [...new Set(needle.split(/\s+/).filter(Boolean))];
  for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const text = Array.from({ length: columnLimit }, (_, index) => cellToText(row.getCell(index + 1).value)).join(" | ");
    const normalized = normalizeSearchText(text);
    if (text.trim() && terms.length > 0 && terms.every((term) => normalized.includes(term))) {
      units.push({ location: `Sheet "${worksheet.name}", baris ${rowNumber}`, text });
      if (units.length >= maxResults) break;
    }
  }
  const warnings: string[] = [];
  if (worksheet.rowCount > maxRows) warnings.push(`Pencarian sheet "${worksheet.name}" dibatasi hingga ${maxRows} baris.`);
  if (worksheet.columnCount > maxColumns) warnings.push(`Pencarian sheet "${worksheet.name}" dibatasi hingga ${maxColumns} kolom.`);
  return { units, warnings };
}
