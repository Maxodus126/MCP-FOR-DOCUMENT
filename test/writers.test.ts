import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsvBuffer, buildXlsxBuffer } from "../src/writers/excel.js";
import { buildDocxBuffer } from "../src/writers/docx.js";
import { buildPdfBuffer } from "../src/writers/pdf.js";
import ExcelJS from "exceljs";

test("buildCsvBuffer meng-escape quote, koma, dan baris baru", () => {
  const buf = buildCsvBuffer(["a", "b"], [["x,1", 'q"z', "baris\nbaru"]]);
  const text = buf.toString("utf8");
  assert.ok(text.includes('"x,1"'));
  assert.ok(text.includes('"q""z"'));
  assert.ok(text.includes("baris\nbaru") || text.includes("\"baris\nbaru\""));
});

test("buildXlsxBuffer menghasilkan workbook yang dapat dibaca ulang", async () => {
  const buf = await buildXlsxBuffer("Data", ["produk", "qty"], [["apel", 3], ["jeruk", 5]]);
  assert.ok(buf.byteLength > 0);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.getWorksheet("Data");
  assert.equal(ws?.getCell("A2").value, "apel");
  assert.equal(ws?.getCell("B3").value, 5);
});

test("buildDocxBuffer menghasilkan DOCX valid", async () => {
  const buf = await buildDocxBuffer("# Judul\n- poin\nparagraf.");
  assert.ok(buf.byteLength > 0);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
});

test("buildPdfBuffer menghasilkan PDF dengan header %PDF-", async () => {
  const buf = await buildPdfBuffer("Halo");
  assert.ok(buf.subarray(0, 5).toString("ascii").startsWith("%PDF-"));
});
