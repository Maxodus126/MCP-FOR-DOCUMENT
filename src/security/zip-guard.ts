import { inflateRawSync } from "node:zlib";
import { AppError } from "../errors.js";
import type { AppConfig } from "../config.js";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const SENTINEL16 = 0xffff;
const SENTINEL32 = 0xffffffff;

export type OfficePackageKind = "docx" | "xlsx";

function ensureRange(buffer: Buffer, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new AppError("INVALID_OFFICE_ARCHIVE", "Struktur arsip Office tidak valid atau terpotong.");
  }
}

function findEocd(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new AppError("INVALID_OFFICE_ARCHIVE", "End of Central Directory ZIP tidak ditemukan atau tidak valid.");
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Preflight DOCX/XLSX archive. It verifies central/local headers, paths,
 * declared and ACTUAL decompressed size, compression ratio and CRC32.
 * It is still not an OS sandbox; parser workers and least-privilege execution
 * remain required for hostile documents.
 */
export function inspectOfficeArchive(
  buffer: Buffer,
  config: Pick<AppConfig, "maxZipExpandedBytes" | "maxZipEntries" | "maxZipCompressionRatio">,
  kind: OfficePackageKind,
): void {
  if (buffer.length < 22) throw new AppError("INVALID_OFFICE_ARCHIVE", "File Office terlalu kecil untuk arsip ZIP.");
  const eocd = findEocd(buffer);
  ensureRange(buffer, eocd, 22);

  const disk = buffer.readUInt16LE(eocd + 4);
  const cdDisk = buffer.readUInt16LE(eocd + 6);
  const entriesDisk = buffer.readUInt16LE(eocd + 8);
  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || entriesDisk !== entries) {
    throw new AppError("UNSUPPORTED_OFFICE_ARCHIVE", "Arsip Office multi-disk tidak didukung.");
  }
  if (entries === SENTINEL16 || cdSize === SENTINEL32 || cdOffset === SENTINEL32) {
    throw new AppError("UNSUPPORTED_OFFICE_ARCHIVE", "Arsip Office ZIP64 tidak didukung.");
  }
  if (entries === 0 || entries > config.maxZipEntries) {
    throw new AppError("OFFICE_ARCHIVE_COMPLEXITY_LIMIT", `Arsip Office harus memiliki 1–${config.maxZipEntries} entry.`);
  }
  ensureRange(buffer, cdOffset, cdSize);
  const cdEnd = cdOffset + cdSize;
  if (cdEnd !== eocd) throw new AppError("INVALID_OFFICE_ARCHIVE", "Offset atau ukuran Central Directory tidak konsisten.");

  let cursor = cdOffset;
  let actualExpandedTotal = 0;
  const names = new Set<string>();
  const dataRanges: Array<{ start: number; end: number }> = [];
  let hasTypes = false;
  let hasMain = false;

  for (let index = 0; index < entries; index += 1) {
    ensureRange(buffer, cursor, 46);
    if (buffer.readUInt32LE(cursor) !== CENTRAL) throw new AppError("INVALID_OFFICE_ARCHIVE", "Entry Central Directory tidak valid.");

    const versionMadeBy = buffer.readUInt16LE(cursor + 4);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const declaredSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    ensureRange(buffer, cursor, recordLength);

    if (compressedSize === SENTINEL32 || declaredSize === SENTINEL32 || localOffset === SENTINEL32) {
      throw new AppError("UNSUPPORTED_OFFICE_ARCHIVE", "Entry ZIP64 tidak didukung.");
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw new AppError("UNSUPPORTED_OFFICE_ARCHIVE", "Arsip Office terenkripsi tidak didukung.");
    }
    if (method !== 0 && method !== 8) throw new AppError("UNSUPPORTED_OFFICE_ARCHIVE", "Metode kompresi ZIP tidak didukung.");

    const nameStart = cursor + 46;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    const normalized = name.replace(/\\/g, "/").toLowerCase();
    if (!name || names.has(normalized) || normalized.startsWith("/") || normalized.split("/").includes("..") || normalized.includes("\0")) {
      throw new AppError("INVALID_OFFICE_ARCHIVE", "Nama entry ZIP kosong, duplikat, atau mengandung path traversal.");
    }
    names.add(normalized);
    if (normalized === "[content_types].xml") hasTypes = true;
    if (kind === "docx" && normalized === "word/document.xml") hasMain = true;
    if (kind === "xlsx" && normalized === "xl/workbook.xml") hasMain = true;

    // Reject Unix symbolic-link entries. versionMadeBy high byte 3 means Unix.
    const hostSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (hostSystem === 3 && (unixMode & 0xf000) === 0xa000) {
      throw new AppError("UNSUPPORTED_OFFICE_ARCHIVE", "Entry symbolic link di dalam arsip Office tidak diizinkan.");
    }

    if (declaredSize > config.maxZipExpandedBytes - actualExpandedTotal) {
      throw new AppError("OFFICE_EXPANSION_LIMIT", "Ukuran hasil dekompresi Office melebihi batas keamanan.");
    }

    ensureRange(buffer, localOffset, 30);
    if (buffer.readUInt32LE(localOffset) !== LOCAL) throw new AppError("INVALID_OFFICE_ARCHIVE", "Local File Header tidak valid.");
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    ensureRange(buffer, localNameStart, localNameLength + localExtraLength);
    const localName = buffer.toString("utf8", localNameStart, localNameStart + localNameLength);
    if (localFlags !== flags || localMethod !== method || localName !== name) {
      throw new AppError("INVALID_OFFICE_ARCHIVE", "Metadata Local File Header dan Central Directory tidak cocok.");
    }
    const dataStart = localNameStart + localNameLength + localExtraLength;
    ensureRange(buffer, dataStart, compressedSize);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > cdOffset) throw new AppError("INVALID_OFFICE_ARCHIVE", "Data entry berada di luar area arsip yang valid.");
    dataRanges.push({ start: localOffset, end: dataEnd });

    const compressed = buffer.subarray(dataStart, dataEnd);
    let expanded: Buffer;
    try {
      expanded = method === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: Math.max(1, config.maxZipExpandedBytes - actualExpandedTotal + 1) });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
      if (code === "ERR_BUFFER_TOO_LARGE") {
        throw new AppError("OFFICE_EXPANSION_LIMIT", "Dekompresi aktual melampaui batas ekspansi yang diizinkan.");
      }
      throw new AppError("INVALID_OFFICE_ARCHIVE", "Data deflate ZIP rusak atau tidak dapat didekompresi.");
    }
    if (expanded.length !== declaredSize) throw new AppError("INVALID_OFFICE_ARCHIVE", "Ukuran hasil dekompresi tidak sesuai metadata ZIP.");
    if (expanded.length > 0 && expanded.length / Math.max(1, compressedSize) > config.maxZipCompressionRatio) {
      throw new AppError("OFFICE_COMPRESSION_RATIO", "Rasio kompresi aktual terlalu tinggi; file ditolak sebagai potensi ZIP bomb.");
    }
    if (crc32(expanded) !== expectedCrc) throw new AppError("INVALID_OFFICE_ARCHIVE", "Checksum CRC32 entry ZIP tidak cocok.");
    actualExpandedTotal += expanded.length;
    if (actualExpandedTotal > config.maxZipExpandedBytes) throw new AppError("OFFICE_EXPANSION_LIMIT", "Ukuran hasil dekompresi Office melebihi batas keamanan.");

    cursor += recordLength;
  }

  if (cursor !== cdEnd) throw new AppError("INVALID_OFFICE_ARCHIVE", "Panjang Central Directory tidak konsisten.");
  dataRanges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < dataRanges.length; i += 1) {
    if (dataRanges[i]!.start < dataRanges[i - 1]!.end) throw new AppError("INVALID_OFFICE_ARCHIVE", "Entry ZIP saling tumpang tindih.");
  }
  if (!hasTypes || !hasMain) throw new AppError("INVALID_OFFICE_PACKAGE", `Arsip bukan paket Office ${kind.toUpperCase()} yang valid.`);
}
