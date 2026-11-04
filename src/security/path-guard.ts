import { constants as fsConstants, promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";

export interface SecureFile {
  canonicalPath: string;
  extension: string;
  stat: Stats;
}

export async function initializeAllowedRoots(entries: string[]): Promise<string[]> {
  if (entries.length === 0) throw new AppError("CONFIG_INVALID", "ALLOWED_DIRS wajib berisi minimal satu direktori.");
  const roots: string[] = [];
  for (const entry of entries) {
    try {
      const canonical = await fs.realpath(path.resolve(entry));
      const stat = await fs.stat(canonical);
      if (!stat.isDirectory()) throw new AppError("CONFIG_INVALID", "Setiap entri ALLOWED_DIRS harus berupa direktori.");
      roots.push(canonical);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("CONFIG_INVALID", "Direktori ALLOWED_DIRS tidak ditemukan atau tidak dapat diakses.");
    }
  }
  return [...new Set(roots)];
}

export function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isAllowed(candidate: string, roots: string[]): boolean {
  return roots.some((root) => isPathWithin(root, candidate));
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
  if (left.dev !== right.dev) return false;
  if (left.ino !== 0 && right.ino !== 0 && left.ino !== right.ino) return false;
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.birthtimeMs === right.birthtimeMs;
}

export async function resolveSecureFile(inputPath: string, allowedRoots: string[], maxFileSizeBytes: number): Promise<SecureFile> {
  if (typeof inputPath !== "string" || inputPath.trim() === "" || inputPath.includes("\0")) {
    throw new AppError("INVALID_PATH", "filePath tidak valid.");
  }
  if (!path.isAbsolute(inputPath)) throw new AppError("INVALID_PATH", "filePath wajib berupa absolute path.");

  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(path.resolve(inputPath));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    if (code === "ENOENT") throw new AppError("FILE_NOT_FOUND", "File tidak ditemukan.");
    if (code === "ELOOP") throw new AppError("SYMLINK_NOT_ALLOWED", "Akses melalui symbolic link tidak diizinkan.");
    throw new AppError("FILE_ACCESS_DENIED", "File tidak dapat diakses.");
  }

  if (!isAllowed(canonicalPath, allowedRoots)) {
    throw new AppError("PATH_OUTSIDE_ALLOWLIST", "Akses ditolak: file berada di luar direktori yang diizinkan.");
  }

  let stat: Stats;
  try { stat = await fs.stat(canonicalPath); }
  catch { throw new AppError("FILE_ACCESS_DENIED", "Metadata file tidak dapat dibaca."); }
  if (!stat.isFile()) throw new AppError("NOT_A_FILE", "Path yang diberikan bukan file reguler.");
  if (stat.size > maxFileSizeBytes) {
    throw new AppError("FILE_TOO_LARGE", `Ukuran file melebihi batas ${Math.floor(maxFileSizeBytes / (1024 * 1024))} MB.`);
  }
  return { canonicalPath, extension: path.extname(canonicalPath).toLowerCase(), stat };
}

export async function readSecureFile(
  file: SecureFile,
  allowedRoots: string[],
  maxFileSizeBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  // O_NOFOLLOW menolak symlink pada komponen terakhir bila didukung OS.
  // O_NONBLOCK mencegah hang jika file diganti menjadi FIFO di antara stat/open.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    if (signal?.aborted) throw new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan sebelum file dibaca.");
    handle = await fs.open(file.canonicalPath, flags);
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw new AppError("NOT_A_FILE", "Path yang diberikan bukan file reguler.");
    if (openedStat.size > maxFileSizeBytes) throw new AppError("FILE_TOO_LARGE", "File melewati batas pemrosesan.");
    if (!sameFileSnapshot(file.stat, openedStat)) throw new AppError("FILE_CHANGED_DURING_ACCESS", "File berubah saat akan dibaca. Ulangi permintaan.");

    const revalidatedPath = await fs.realpath(file.canonicalPath);
    if (!isAllowed(revalidatedPath, allowedRoots)) throw new AppError("PATH_OUTSIDE_ALLOWLIST", "Akses ditolak setelah validasi ulang path.");
    const currentPathStat = await fs.stat(revalidatedPath);
    if (!sameFileSnapshot(openedStat, currentPathStat)) throw new AppError("FILE_CHANGED_DURING_ACCESS", "File berubah saat akan dibaca. Ulangi permintaan.");
    if (signal?.aborted) throw new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan sebelum file dibaca.");

    const stream = handle.createReadStream({ autoClose: false });
    const abortStream = () => stream.destroy(new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan saat membaca file."));
    signal?.addEventListener("abort", abortStream, { once: true });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      for await (const chunk of stream) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += part.length;
        if (totalBytes > maxFileSizeBytes) {
          stream.destroy();
          throw new AppError("FILE_TOO_LARGE", "File bertambah besar dan melewati batas pemrosesan.");
        }
        chunks.push(part);
      }
    } catch (error) {
      if (signal?.aborted) throw new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan saat membaca file.");
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortStream);
    }
    const finalStat = await handle.stat();
    if (!sameFileSnapshot(openedStat, finalStat)) throw new AppError("FILE_CHANGED_DURING_ACCESS", "File berubah selama proses pembacaan. Ulangi permintaan.");
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    if (code === "ENOENT") throw new AppError("FILE_NOT_FOUND", "File tidak ditemukan.");
    if (code === "ELOOP") throw new AppError("SYMLINK_NOT_ALLOWED", "Akses melalui symbolic link tidak diizinkan.");
    if (code === "EACCES" || code === "EPERM") throw new AppError("FILE_ACCESS_DENIED", "Sistem operasi menolak akses ke file.");
    throw new AppError("FILE_READ_FAILED", "File gagal dibaca.");
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}
