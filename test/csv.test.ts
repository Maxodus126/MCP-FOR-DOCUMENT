import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors.js";
import { decodeCsvBuffer, parseCsvBuffer } from "../src/extractors/csv.js";

test("CSV parser detects semicolon and preserves quoted delimiters and escaped quotes", () => {
  const input = 'name;note\r\nAlya;"finance; risk"\r\nBima;"say ""hello"""\r\n';
  const parsed = parseCsvBuffer(Buffer.from(input, "utf8"), 10, 10);
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.rows, [
    ["name", "note"],
    ["Alya", "finance; risk"],
    ["Bima", 'say "hello"'],
  ]);
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.totalColumns, 2);
});

test("CSV parser supports embedded newlines in quoted fields", () => {
  const parsed = parseCsvBuffer(Buffer.from('id,note\n1,"first line\nsecond line"\n2,done', "utf8"), 10, 10);
  assert.deepEqual(parsed.rows, [["id", "note"], ["1", "first line\nsecond line"], ["2", "done"]]);
  assert.equal(parsed.totalRows, 3);
});

test("CSV parser scans total dimensions while retaining only configured rows and columns", () => {
  const parsed = parseCsvBuffer(Buffer.from("a,b,c\n1,2,3\n4,5,6\n", "utf8"), 2, 2);
  assert.deepEqual(parsed.rows, [["a", "b"], ["1", "2"]]);
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.totalColumns, 3);
});

test("CSV parser supports UTF-16LE BOM", () => {
  const body = Buffer.from("nama;nilai\nAlya;10", "utf16le");
  const input = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  assert.match(decodeCsvBuffer(input), /nama;nilai/);
  const parsed = parseCsvBuffer(input, 10, 10);
  assert.deepEqual(parsed.rows, [["nama", "nilai"], ["Alya", "10"]]);

  const utf16le = Buffer.from("nama;nilai\nBima;20", "utf16le");
  const utf16be = Buffer.from(utf16le);
  for (let index = 0; index + 1 < utf16be.length; index += 2) {
    const byte = utf16be[index]!; utf16be[index] = utf16be[index + 1]!; utf16be[index + 1] = byte;
  }
  const beInput = Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be]);
  assert.deepEqual(parseCsvBuffer(beInput, 10, 10).rows, [["nama", "nilai"], ["Bima", "20"]]);
});

test("CSV parser rejects unmatched quote", () => {
  assert.throws(() => parseCsvBuffer(Buffer.from('a,b\n1,"unfinished', "utf8"), 10, 10), (error: unknown) => error instanceof AppError && error.code === "CSV_PARSE_FAILED");
});
