import path from "node:path";
import { AppError } from "./errors.js";

export interface AppConfig {
  allowedDirEntries: string[];
  allowedOutputDirEntries: string[];
  maxFileSizeMb: number;
  maxFileSizeBytes: number;
  maxOutputSizeBytes: number;
  maxInputChars: number;
  maxOutputChars: number;
  maxConcurrentTools: number;
  maxQueuedTools: number;
  maxQueueWaitMs: number;
  maxProcessingTimeoutMs: number;
  workerOldSpaceMb: number;
  workerSemiSpaceMb: number;
  maxZipExpandedBytes: number;
  maxZipEntries: number;
  maxZipCompressionRatio: number;
  maxExcelScanRows: number;
  maxExcelScanColumns: number;
  maxPdfPages: number;
}

function readInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new AppError("CONFIG_INVALID", `${name} harus berupa bilangan bulat antara ${min} dan ${max}.`);
  return value;
}

export function parseAllowedDirectories(raw: string | undefined, delimiter = path.delimiter): string[] {
  if (!raw || raw.trim() === "") throw new AppError("CONFIG_INVALID", "ALLOWED_DIRS wajib diisi dengan minimal satu direktori absolut.");
  const entries = raw.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) throw new AppError("CONFIG_INVALID", "ALLOWED_DIRS tidak berisi direktori valid.");
  for (const entry of entries) if (entry.includes("\0") || !path.isAbsolute(entry)) throw new AppError("CONFIG_INVALID", "Semua entri ALLOWED_DIRS harus berupa absolute path.");
  return [...new Set(entries.map((entry) => path.resolve(entry)))];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const maxFileSizeMb = readInteger(env, "MAX_FILE_SIZE_MB", 50, 1, 50);
  const maxZipExpandedMb = readInteger(env, "MAX_ZIP_EXPANDED_MB", 100, 10, 200);
  const allowedDirEntries = parseAllowedDirectories(env.ALLOWED_DIRS);
  const allowedOutputDirEntries = env.ALLOWED_OUTPUT_DIRS && env.ALLOWED_OUTPUT_DIRS.trim() !== ""
    ? parseAllowedDirectories(env.ALLOWED_OUTPUT_DIRS)
    : allowedDirEntries;
  return {
    allowedDirEntries,
    allowedOutputDirEntries,
    maxFileSizeMb,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    maxOutputSizeBytes: maxFileSizeMb * 1024 * 1024,
    maxInputChars: readInteger(env, "MAX_INPUT_CHARS", 100_000, 1_000, 250_000),
    maxOutputChars: readInteger(env, "MAX_OUTPUT_CHARS", 100_000, 1_000, 250_000),
    maxConcurrentTools: readInteger(env, "MAX_CONCURRENT_TOOLS", 1, 1, 4),
    maxQueuedTools: readInteger(env, "MAX_QUEUED_TOOLS", 16, 0, 64),
    maxQueueWaitMs: readInteger(env, "MAX_QUEUE_WAIT_MS", 30_000, 1_000, 180_000),
    maxProcessingTimeoutMs: readInteger(env, "MAX_PROCESSING_TIMEOUT_MS", 60_000, 1_000, 300_000),
    workerOldSpaceMb: readInteger(env, "WORKER_OLD_SPACE_MB", 384, 128, 1_024),
    workerSemiSpaceMb: readInteger(env, "WORKER_SEMI_SPACE_MB", 16, 8, 128),
    maxZipExpandedBytes: maxZipExpandedMb * 1024 * 1024,
    maxZipEntries: readInteger(env, "MAX_ZIP_ENTRIES", 2_000, 1, 10_000),
    maxZipCompressionRatio: readInteger(env, "MAX_ZIP_COMPRESSION_RATIO", 100, 1, 500),
    maxExcelScanRows: readInteger(env, "MAX_EXCEL_SCAN_ROWS", 20_000, 1, 100_000),
    maxExcelScanColumns: readInteger(env, "MAX_EXCEL_SCAN_COLUMNS", 50, 1, 100),
    maxPdfPages: readInteger(env, "MAX_PDF_PAGES", 1_000, 1, 5_000),
  };
}
