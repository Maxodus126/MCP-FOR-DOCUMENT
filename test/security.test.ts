import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppError } from "../src/errors.js";
import { isPathWithin, initializeAllowedRoots, readSecureFile, resolveSecureFile } from "../src/security/path-guard.js";
import { inspectOfficeArchive } from "../src/security/zip-guard.js";
import { validateFileSignature } from "../src/security/signature.js";
import type { AppConfig } from "../src/config.js";
import { parseAllowedDirectories, loadConfig } from "../src/config.js";
import { cleanText, truncateText } from "../src/utils/text.js";

const ZIP_CONFIG: Pick<AppConfig, "maxZipExpandedBytes" | "maxZipEntries" | "maxZipCompressionRatio"> = {
  maxZipExpandedBytes: 1024 * 1024,
  maxZipEntries: 100,
  maxZipCompressionRatio: 200,
};

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: Array<{ name: string; content: string; compress?: boolean }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content, "utf8");
    const compressed = entry.compress ? deflateRawSync(content) : content;
    const method = entry.compress ? 8 : 0;
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const docxEntries = [
  { name: "[Content_Types].xml", content: "<Types/>", compress: true },
  { name: "word/document.xml", content: "<document><p>hello</p></document>", compress: true },
];

test("allowed directory parsing requires absolute paths", () => {
  const parsed = parseAllowedDirectories(`${path.resolve("documents")}${path.delimiter}${path.resolve("shared")}`);
  assert.equal(parsed.length, 2);
  assert.throws(() => parseAllowedDirectories("relative/documents"), /absolute path/i);
  assert.throws(() => parseAllowedDirectories("  "), /ALLOWED_DIRS wajib/i);
});

test("file limit cannot be configured above 50 MB", () => {
  assert.throws(() => loadConfig({ ALLOWED_DIRS: path.resolve("documents"), MAX_FILE_SIZE_MB: "51" } as NodeJS.ProcessEnv), /MAX_FILE_SIZE_MB/);
});

test("path containment rejects sibling-prefix traversal", () => {
  const root = path.resolve("/tmp/mcp-documents");
  assert.equal(isPathWithin(root, path.join(root, "report.pdf")), true);
  assert.equal(isPathWithin(root, path.resolve("/tmp/mcp-documents-evil/secret.pdf")), false);
  assert.equal(isPathWithin(root, path.resolve("/tmp/secret.pdf")), false);
});

test("secure reader only permits regular files inside canonical roots", async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mcp-reader-test-"));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  const allowed = path.join(temp, "allowed");
  const outside = path.join(temp, "outside");
  await mkdir(allowed);
  await mkdir(outside);
  const safeFile = path.join(allowed, "safe.csv");
  const outsideFile = path.join(outside, "secret.csv");
  await writeFile(safeFile, "a,b\n1,2");
  await writeFile(outsideFile, "secret");
  const roots = await initializeAllowedRoots([allowed]);
  const secure = await resolveSecureFile(safeFile, roots, 1024);
  await assert.rejects(() => resolveSecureFile(safeFile, roots, 2), (error: unknown) => error instanceof AppError && error.code === "FILE_TOO_LARGE");
  assert.equal((await readSecureFile(secure, roots, 1024)).toString("utf8"), "a,b\n1,2");
  assert.equal((await readFile(secure.canonicalPath)).toString("utf8"), "a,b\n1,2");
  await assert.rejects(() => resolveSecureFile(outsideFile, roots, 1024), (error: unknown) => error instanceof AppError && error.code === "PATH_OUTSIDE_ALLOWLIST");
  await assert.rejects(() => resolveSecureFile("relative.csv", roots, 1024), (error: unknown) => error instanceof AppError && error.code === "INVALID_PATH");
  const link = path.join(allowed, "outside-link.csv");
  let symlinkCreated = false;
  try {
    await symlink(outsideFile, link);
    symlinkCreated = true;
  } catch (error) {
    if (process.platform !== "win32") throw error;
    t.diagnostic("Symlink test skipped: Windows symlink privilege is unavailable.");
  }
  if (symlinkCreated) {
    await assert.rejects(() => resolveSecureFile(link, roots, 1024), (error: unknown) => error instanceof AppError && error.code === "PATH_OUTSIDE_ALLOWLIST");
  }
});

test("Office ZIP guard validates real decompression size and CRC", () => {
  const valid = makeZip(docxEntries);
  assert.doesNotThrow(() => inspectOfficeArchive(valid, ZIP_CONFIG, "docx"));
  assert.throws(() => inspectOfficeArchive(Buffer.from("not a zip"), ZIP_CONFIG, "docx"), (error: unknown) => error instanceof AppError && error.code === "INVALID_OFFICE_ARCHIVE");
  assert.throws(() => inspectOfficeArchive(valid, { ...ZIP_CONFIG, maxZipExpandedBytes: 5 }, "docx"), (error: unknown) => error instanceof AppError && error.code === "OFFICE_EXPANSION_LIMIT");
  const badCrc = Buffer.from(valid);
  const eocd = badCrc.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const centralOffset = badCrc.readUInt32LE(eocd + 16);
  badCrc.writeUInt32LE(badCrc.readUInt32LE(centralOffset + 16) ^ 0x01, centralOffset + 16);
  assert.throws(() => inspectOfficeArchive(badCrc, ZIP_CONFIG, "docx"), (error: unknown) => error instanceof AppError && error.code === "INVALID_OFFICE_ARCHIVE");
  assert.throws(() => inspectOfficeArchive(valid, ZIP_CONFIG, "xlsx"), (error: unknown) => error instanceof AppError && error.code === "INVALID_OFFICE_PACKAGE");
});

test("Office ZIP guard rejects high actual compression ratio and traversal names", () => {
  const bombLike = makeZip([
    { name: "[Content_Types].xml", content: "<Types/>", compress: true },
    { name: "word/document.xml", content: "A".repeat(50_000), compress: true },
  ]);
  assert.throws(() => inspectOfficeArchive(bombLike, ZIP_CONFIG, "docx"), (error: unknown) => error instanceof AppError && error.code === "OFFICE_COMPRESSION_RATIO");
  const traversal = makeZip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    { name: "../word/document.xml", content: "<document/>" },
  ]);
  assert.throws(() => inspectOfficeArchive(traversal, ZIP_CONFIG, "docx"), (error: unknown) => error instanceof AppError && error.code === "INVALID_OFFICE_ARCHIVE");
});

test("file signature validation rejects extension spoofing", () => {
  assert.doesNotThrow(() => validateFileSignature(Buffer.from("%PDF-1.7\n"), ".pdf"));
  assert.throws(() => validateFileSignature(Buffer.from("not a PDF"), ".pdf"), (error: unknown) => error instanceof AppError && error.code === "FILE_SIGNATURE_MISMATCH");
  assert.throws(() => validateFileSignature(Buffer.from([0, 1, 2, 3]), ".csv"), (error: unknown) => error instanceof AppError && error.code === "FILE_SIGNATURE_MISMATCH");
});

test("text sanitation removes null bytes and truncation remains within limit", () => {
  assert.equal(cleanText("A\0B\r\nC"), "AB\nC");
  const result = truncateText("12345678901234567890", 12);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 12);
});
