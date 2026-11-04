import { AppError, toPublicError } from "./errors.js";
import type ExcelJS from "exceljs";
import { stat, unlink, writeFile, rename } from "node:fs/promises";
import type { AppConfig } from "./config.js";
import { getPdfPageCount, extractPdfPages } from "./extractors/pdf.js";
import { extractWordContent } from "./extractors/word.js";
import {
  loadWorkbook, searchWorksheet, worksheetToTable,
  csvToTable, searchCsvBuffer, cellToValue,
  type SpreadsheetTable,
} from "./extractors/spreadsheet.js";
import { parseCsvBuffer } from "./extractors/csv.js";
import { rankMatches, type SearchUnit } from "./utils/search.js";
import { truncateText } from "./utils/text.js";
import type { SecureFile } from "./security/path-guard.js";
import type { ParserJob, RowValues } from "./worker-runner.js";
import { buildPdfBuffer } from "./writers/pdf.js";
import { buildDocxBuffer } from "./writers/docx.js";
import { buildCsvBuffer, buildXlsxBuffer } from "./writers/excel.js";

interface IncomingMessage { job: ParserJob; config: AppConfig; bytes?: Uint8Array; }

console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.warn = (...args: unknown[]) => console.error(...args);

function selectedTableLength(table: SpreadsheetTable, format: "markdown" | "json"): number {
  return format === "json" ? table.json.length : table.markdown.length;
}

function fallbackTable(sheetName: string, totalRows: number, totalColumns: number, format: "markdown" | "json"): SpreadsheetTable {
  return {
    sheetName,
    markdown: format === "markdown" ? "_(Header atau satu baris pertama melebihi batas output; kurangi kolom)_" : "",
    json: format === "json" ? JSON.stringify({ sheetName, columns: [], rows: [], rowsReturned: 0, totalRows, totalColumns, truncated: true, warning: "Header terlalu besar untuk batas output. Kurangi kolom atau ekspor ulang file." }) : "",
    rowsReturned: 0, totalRows, columnsReturned: 0, totalColumns, truncated: true,
  };
}

function fitWorksheetTable(
  worksheet: ExcelJS.Worksheet,
  requestedRows: number,
  maxColumns: number,
  maxChars: number,
  format: "markdown" | "json",
): SpreadsheetTable {
  let table = worksheetToTable(worksheet, requestedRows, maxColumns);
  if (selectedTableLength(table, format) <= maxChars) return table;
  let low = 1;
  let high = requestedRows;
  let best: SpreadsheetTable | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = worksheetToTable(worksheet, middle, maxColumns);
    if (selectedTableLength(candidate, format) <= maxChars) {
      best = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!best) return fallbackTable(worksheet.name, worksheet.rowCount, worksheet.columnCount, format);
  best.truncated = true;
  return best;
}

function fitCsvTable(
  buffer: Buffer,
  requestedRows: number,
  maxColumns: number,
  maxChars: number,
  format: "markdown" | "json",
): SpreadsheetTable {
  const parsed = parseCsvBuffer(buffer, requestedRows, maxColumns);
  let table = csvToTable(parsed, requestedRows, maxColumns);
  if (selectedTableLength(table, format) <= maxChars) return table;
  let low = 1;
  let high = Math.max(1, Math.min(requestedRows, parsed.rows.length));
  let best: SpreadsheetTable | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = csvToTable({ ...parsed, rows: parsed.rows.slice(0, middle) }, middle, maxColumns);
    if (selectedTableLength(candidate, format) <= maxChars) {
      best = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!best) return fallbackTable("CSV", parsed.totalRows, parsed.totalColumns, format);
  best.truncated = true;
  return best;
}

async function writeFileAtomic(destPath: string, data: Buffer, maxBytes: number): Promise<void> {
  if (data.length > maxBytes) {
    throw new AppError("OUTPUT_TOO_LARGE", `Ukuran output (${data.length} byte) melebihi batas ${maxBytes} byte.`);
  }
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, data, { flag: "wx" });
    const st = await stat(tmp);
    if (st.size > maxBytes) throw new AppError("OUTPUT_TOO_LARGE", "Ukuran output melebihi batas setelah penulisan.");
    try {
      await rename(tmp, destPath);
    } catch {
      await unlink(destPath).catch(() => undefined);
      await rename(tmp, destPath);
    }
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw new AppError("OUTPUT_WRITE_FAILED", "Output gagal ditulis ke direktori tujuan.");
  }
}

async function extractDocumentMarkdown(buffer: Buffer, sourceExtension: string, config: AppConfig): Promise<string> {
  if (sourceExtension === ".pdf") {
    const pdf = await extractPdfPages(buffer, config.maxPdfPages);
    return pdf.pageMappingAvailable
      ? pdf.pages.map((page) => `## Halaman ${page.page}\n${page.text.trim()}`).join("\n\n")
      : (pdf.pages[0]?.text ?? "");
  }
  if (sourceExtension === ".docx") {
    const word = await extractWordContent(buffer, config);
    return word.markdown || word.paragraphs.join("\n\n");
  }
  // .xlsx / .csv
  const rowLimit = config.maxExcelScanRows;
  const colLimit = config.maxExcelScanColumns;
  if (sourceExtension === ".csv") {
    const parsed = parseCsvBuffer(buffer, rowLimit, colLimit);
    return csvToTable(parsed, rowLimit, colLimit).markdown;
  }
  const workbook = await loadWorkbook({ extension: ".xlsx" } as SecureFile, buffer, config);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return "_(Dokumen kosong)_";
  return worksheetToTable(worksheet, rowLimit, colLimit).markdown;
}

async function extractSpreadsheetData(
  buffer: Buffer,
  sourceExtension: string,
  config: AppConfig,
): Promise<{ headers: string[]; rows: RowValues[] } | null> {
  if (sourceExtension !== ".xlsx" && sourceExtension !== ".csv") return null;
  const rowLimit = config.maxExcelScanRows;
  const colLimit = config.maxExcelScanColumns;
  if (sourceExtension === ".csv") {
    const parsed = parseCsvBuffer(buffer, rowLimit, colLimit);
    const headers = (parsed.rows[0] ?? []) as string[];
    const rows: RowValues[] = parsed.rows.slice(1).map((row) => row as RowValues);
    return { headers, rows };
  }
  const workbook = await loadWorkbook({ extension: ".xlsx" } as SecureFile, buffer, config);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { headers: [], rows: [] };
  const rowsReturned = Math.min(worksheet.rowCount, rowLimit);
  const colsReturned = Math.min(worksheet.columnCount, colLimit);
  const matrix: CellValueMatrix = [];
  for (let rowNumber = 1; rowNumber <= rowsReturned; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    matrix.push(Array.from({ length: colsReturned }, (_, columnIndex) => {
      const value = row.getCell(columnIndex + 1).value;
      return typeof value === "object" && value !== null ? cellToValue(value) as CellValue : value as CellValue;
    }));
  }
  const headers = (matrix[0] ?? []).map((value) => value === null ? "" : String(value));
  return { headers, rows: matrix.slice(1) };
}

type CellValue = string | number | boolean | null;
type CellValueMatrix = CellValue[][];

async function buildConvertedBytes(job: Extract<ParserJob, { kind: "convert" }>, buffer: Buffer, config: AppConfig): Promise<Buffer> {
  const target = job.targetFormat;
  if (target === "xlsx" || target === "csv") {
    const data = await extractSpreadsheetData(buffer, job.sourceExtension, config);
    if (!data) {
      const md = await extractDocumentMarkdown(buffer, job.sourceExtension, config);
      const lines = md.split("\n").map((line) => line.trim()).filter(Boolean);
      return target === "csv"
        ? buildCsvBuffer(["Konten"], lines.map((line) => [line]))
        : await buildXlsxBuffer("Konten", ["Konten"], lines.map((line) => [line]));
    }
    return target === "csv"
      ? buildCsvBuffer(data.headers, data.rows)
      : await buildXlsxBuffer(job.sheetName ?? "Sheet1", data.headers, data.rows);
  }
  const md = await extractDocumentMarkdown(buffer, job.sourceExtension, config);
  return target === "pdf" ? await buildPdfBuffer(md) : await buildDocxBuffer(md);
}

async function processJob(message: IncomingMessage): Promise<unknown> {
  const buffer = message.bytes ? Buffer.from(message.bytes) : Buffer.alloc(0);
  const { job, config } = message;
  switch (job.kind) {
    case "pdf-info":
      return await getPdfPageCount(buffer, config.maxPdfPages);

    case "pdf-read": {
      if (job.endPage !== undefined && job.endPage < job.startPage) {
        throw new AppError("INVALID_PAGE_RANGE", "endPage tidak boleh lebih kecil daripada startPage.");
      }
      const pdf = await extractPdfPages(buffer, config.maxPdfPages, job.endPage === undefined
        ? { startPage: job.startPage }
        : { startPage: job.startPage, endPage: job.endPage });
      if (job.startPage > pdf.totalPages || (job.endPage !== undefined && job.endPage > pdf.totalPages)) {
        throw new AppError("PAGE_OUT_OF_RANGE", `Rentang halaman di luar dokumen. Total halaman: ${pdf.totalPages}.`);
      }
      if (!pdf.pageMappingAvailable && (job.startPage !== 1 || job.endPage !== undefined)) {
        throw new AppError("PAGE_MAPPING_UNAVAILABLE", "Parser tidak dapat memetakan teks ke nomor halaman. Hilangkan endPage untuk membaca seluruh teks yang tersedia.");
      }
      const lastPage = job.endPage ?? pdf.totalPages;
      const selected = pdf.pages;
      const rawText = pdf.pageMappingAvailable
        ? selected.map((page) => `## Halaman ${page.page}\n${page.text.trim()}`).join("\n\n")
        : `## Teks PDF (halaman tidak terpetakan)\n${selected[0]?.text.trim() ?? ""}`;
      const limited = truncateText(rawText, Math.min(job.maxChars, config.maxOutputChars));
      return {
        totalPages: pdf.totalPages,
        pageMappingAvailable: pdf.pageMappingAvailable,
        selectedPageCount: selected.length,
        hasExtractableText: selected.some((page) => page.text.trim().length > 0),
        blankPages: pdf.pageMappingAvailable ? selected.filter((page) => page.text.trim().length <= 20).map((page) => page.page) : [],
        text: limited.text,
        truncated: limited.truncated,
      };
    }

    case "pdf-search": {
      const pdf = await extractPdfPages(buffer, config.maxPdfPages);
      const units: SearchUnit[] = pdf.pageMappingAvailable
        ? pdf.pages.map((page) => ({ location: `Halaman ${page.page}`, text: page.text }))
        : [{ location: "Halaman tidak terpetakan", text: pdf.pages[0]?.text ?? "" }];
      const warnings: string[] = [];
      if (!pdf.hasExtractableText) warnings.push("PDF tidak memiliki teks yang dapat diekstrak; kemungkinan scan/gambar dan membutuhkan OCR.");
      return {
        matches: rankMatches(units, job.query, job.maxResults),
        warnings,
        ...(!pdf.pageMappingAvailable ? { locationNote: "Pemetaan nomor halaman PDF tidak tersedia." } : {}),
      };
    }

    case "word-read": {
      const word = await extractWordContent(buffer, config);
      const limited = truncateText(word.markdown, Math.min(job.maxChars, config.maxOutputChars));
      return { markdown: limited.text, warnings: word.warnings, truncated: limited.truncated, originalChars: word.markdown.length };
    }

    case "word-search": {
      const word = await extractWordContent(buffer, config);
      const units = word.paragraphs.map((text, index) => ({ location: `Paragraf ${index + 1}`, text }));
      return {
        matches: rankMatches(units, job.query, job.maxResults),
        warnings: word.warnings,
        locationNote: "DOCX tidak memiliki nomor halaman stabil; lokasi berdasarkan urutan paragraf.",
      };
    }

    case "excel-read": {
      let sheetName: string;
      let availableSheets: string[];
      let table: SpreadsheetTable;
      if (job.extension === ".csv") {
        if (job.sheetName && job.sheetName.toLocaleLowerCase("id-ID") !== "csv") {
          throw new AppError("SHEET_NOT_FOUND", "CSV hanya memiliki satu sheet bernama CSV.");
        }
        sheetName = "CSV";
        availableSheets = ["CSV"];
        table = fitCsvTable(buffer, job.maxRows, job.maxColumns, config.maxOutputChars, job.outputFormat);
      } else {
        const file = { extension: job.extension } as SecureFile;
        const workbook = await loadWorkbook(file, buffer, config);
        const worksheet = job.sheetName ? workbook.getWorksheet(job.sheetName) : workbook.worksheets[0];
        if (!worksheet) {
          throw new AppError("SHEET_NOT_FOUND", `Sheet tidak ditemukan. Sheet tersedia: ${workbook.worksheets.map((item) => item.name).join(", ") || "tidak ada"}.`);
        }
        sheetName = worksheet.name;
        availableSheets = workbook.worksheets.map((item) => item.name);
        table = fitWorksheetTable(worksheet, job.maxRows, job.maxColumns, config.maxOutputChars, job.outputFormat);
      }
      // Transfer only the requested representation to keep IPC payload small.
      if (job.outputFormat === "json") table.markdown = "";
      else table.json = "";
      return { sheetName, availableSheets, table };
    }

    case "excel-search": {
      let units: SearchUnit[] = [];
      const warnings: string[] = [];
      if (job.extension === ".csv") {
        const result = searchCsvBuffer(buffer, job.query, config.maxExcelScanRows, config.maxExcelScanColumns, job.maxResults * 5);
        units = result.units;
        warnings.push(...result.warnings);
      } else {
        const file = { extension: job.extension } as SecureFile;
        const workbook = await loadWorkbook(file, buffer, config);
        for (const worksheet of workbook.worksheets) {
          const found = searchWorksheet(worksheet, job.query, config.maxExcelScanRows, config.maxExcelScanColumns, job.maxResults * 5);
          units.push(...found.units);
          warnings.push(...found.warnings);
          if (units.length >= job.maxResults * 10) break;
        }
      }
      return { matches: rankMatches(units, job.query, job.maxResults), warnings };
    }

    case "pdf-create": {
      const bytes = await buildPdfBuffer(job.text);
      await writeFileAtomic(job.destPath, bytes, job.maxBytes);
      return { path: job.destPath, bytes: bytes.length };
    }

    case "docx-create": {
      const bytes = await buildDocxBuffer(job.markdown);
      await writeFileAtomic(job.destPath, bytes, job.maxBytes);
      return { path: job.destPath, bytes: bytes.length };
    }

    case "excel-create": {
      const bytes = job.extension === ".csv"
        ? buildCsvBuffer(job.headers, job.rows)
        : await buildXlsxBuffer(job.sheetName, job.headers, job.rows);
      await writeFileAtomic(job.destPath, bytes, job.maxBytes);
      return { path: job.destPath, bytes: bytes.length };
    }

    case "convert": {
      const srcBytes = message.bytes ? Buffer.from(message.bytes) : Buffer.alloc(0);
      const bytes = await buildConvertedBytes(job, srcBytes, config);
      await writeFileAtomic(job.destPath, bytes, job.maxBytes);
      return { path: job.destPath, bytes: bytes.length };
    }

    default: {
      const exhaustive: never = job;
      throw new AppError("UNKNOWN_WORKER_JOB", `Jenis pekerjaan parser tidak dikenal: ${String(exhaustive)}.`);
    }
  }
}

let handled = false;
process.on("message", async (message: IncomingMessage) => {
  if (handled) return;
  handled = true;
  try {
    const result = await processJob(message);
    const sendMessage = process.send as (message: unknown, callback?: (error: Error | null) => void) => boolean;
    if (sendMessage) sendMessage.call(process, { ok: true, result }, () => process.disconnect?.());
    else process.exitCode = 1;
  } catch (error) {
    const issue = toPublicError(error);
    const sendMessage = process.send as (message: unknown, callback?: (error: Error | null) => void) => boolean;
    if (sendMessage) sendMessage.call(process, { ok: false, error: issue }, () => process.disconnect?.());
    else process.exitCode = 1;
  }
});
