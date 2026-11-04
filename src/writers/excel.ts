import ExcelJS from "exceljs";

export type CellValue = string | number | boolean | null;
export type RowValues = CellValue[];

function csvEscape(value: CellValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsvBuffer(headers: string[], rows: RowValues[]): Buffer {
  const lines: string[] = [];
  if (headers.length) lines.push(headers.map(csvEscape).join(","));
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return Buffer.from(lines.join("\r\n") + (lines.length ? "\r\n" : ""), "utf8");
}

export async function buildXlsxBuffer(sheetName: string, headers: string[], rows: RowValues[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName || "Sheet1");
  if (headers.length) worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
