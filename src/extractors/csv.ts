import { AppError } from "../errors.js";
import { cleanText } from "../utils/text.js";

export function decodeCsvBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return cleanText(buffer.subarray(2).toString("utf16le"));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const byte = swapped[i]!;
      swapped[i] = swapped[i + 1]!;
      swapped[i + 1] = byte;
    }
    return cleanText(swapped.toString("utf16le"));
  }
  return cleanText(buffer.toString("utf8")).replace(/^\uFEFF/, "");
}

function detectCsvDelimiter(text: string): string {
  const candidates = [",", ";", "\t", "|"];
  const counts = new Map(candidates.map((candidate) => [candidate, 0]));
  let quoted = false;
  for (let index = 0; index < Math.min(text.length, 16_384); index += 1) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) break;
    if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return candidates.reduce((best, candidate) => counts.get(candidate)! > counts.get(best)! ? candidate : best, ",");
}

export interface ParsedCsv {
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  delimiter: string;
}

/** CSV state machine: handles quoted delimiters, escaped quotes and embedded newlines. */
export function parseCsvBuffer(buffer: Buffer, maxStoredRows: number, maxStoredColumns: number): ParsedCsv {
  const text = decodeCsvBuffer(buffer);
  const delimiter = detectCsvDelimiter(text);
  const rows: string[][] = [];
  let storedRow: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowIndex = 0;
  let columnIndex = 0;
  let totalRows = 0;
  let totalColumns = 0;
  let rowTouched = false;

  const pushField = () => {
    totalColumns = Math.max(totalColumns, columnIndex + 1);
    if (rowIndex < maxStoredRows && columnIndex < maxStoredColumns) storedRow.push(cleanText(field));
    field = "";
    columnIndex += 1;
  };
  const pushRow = () => {
    pushField();
    totalRows += 1;
    if (rowIndex < maxStoredRows) rows.push(storedRow);
    rowIndex += 1;
    storedRow = [];
    columnIndex = 0;
    rowTouched = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          if (rowIndex < maxStoredRows && columnIndex < maxStoredColumns) field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else if (rowIndex < maxStoredRows && columnIndex < maxStoredColumns) {
        field += char;
      }
      rowTouched = true;
      continue;
    }
    if (char === '"' && field.length === 0) {
      inQuotes = true;
      rowTouched = true;
    } else if (char === delimiter) {
      pushField();
      rowTouched = true;
    } else if (char === "\n" || char === "\r") {
      pushRow();
      if (char === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      if (rowIndex < maxStoredRows && columnIndex < maxStoredColumns) field += char;
      rowTouched = true;
    }
  }
  if (inQuotes) throw new AppError("CSV_PARSE_FAILED", "CSV memiliki tanda kutip yang tidak berpasangan.");
  if (rowTouched || field.length > 0 || columnIndex > 0) pushRow();
  return { rows, totalRows, totalColumns, delimiter };
}

