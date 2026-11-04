import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";

/**
 * Validates write destinations. Writes are restricted to a basename-only
 * file inside an explicit allowlist of output directories. The client can
 * never supply a path (no traversal, no absolute path, no subdirectory).
 */
export interface SecureOutputFile {
  canonicalPath: string;
  overwrite: boolean;
  extension: string;
}

export async function initializeAllowedOutputRoots(entries: string[]): Promise<string[]> {
  if (entries.length === 0) throw new AppError("CONFIG_INVALID", "ALLOWED_OUTPUT_DIRS wajib berisi minimal satu direktori.");
  const roots: string[] = [];
  for (const entry of entries) {
    try {
      const canonical = await fs.realpath(path.resolve(entry));
      const stat = await fs.stat(canonical);
      if (!stat.isDirectory()) throw new AppError("CONFIG_INVALID", "Setiap entri ALLOWED_OUTPUT_DIRS harus berupa direktori.");
      roots.push(canonical);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("CONFIG_INVALID", "Direktori ALLOWED_OUTPUT_DIRS tidak ditemukan atau tidak dapat diakses.");
    }
  }
  return [...new Set(roots)];
}

/**
 * @param fileName   basename only. No separators, no "..", no absolute paths.
 * @param roots      canonical output directories.
 * @param extensions allowed extensions (lowercase, with leading dot) for this tool.
 * @param overwrite  allow replacing an existing file.
 */
export async function resolveOutputFile(
  fileName: string,
  roots: string[],
  extensions: Set<string>,
  overwrite: boolean,
): Promise<SecureOutputFile> {
  if (typeof fileName !== "string" || fileName.trim() === "" || fileName.includes("\0")) {
    throw new AppError("INVALID_OUTPUT_NAME", "Nama file output tidak valid.");
  }
  if (fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new AppError("INVALID_OUTPUT_NAME", "Nama file output harus berupa basename tanpa path/direktori.");
  }
  if (process.platform === "win32") {
    const base = fileName.split(".")[0]!.toLowerCase();
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(base)) {
      throw new AppError("INVALID_OUTPUT_NAME", "Nama file output menggunakan nama perangkat yang dicadangkan Windows.");
    }
  }
  const extension = path.extname(fileName).toLowerCase();
  if (!extension || !extensions.has(extension)) {
    throw new AppError("UNSUPPORTED_OUTPUT_FORMAT", `Format output tidak diizinkan untuk tool ini. Diizinkan: ${[...extensions].join(", ")}.`);
  }

  let canonicalRoot: string | undefined;
  for (const root of roots) {
    const candidate = path.resolve(root, fileName);
    if (!candidate.startsWith(root + path.sep)) continue;
    const relative = path.relative(root, candidate);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
    canonicalRoot = root;
    break;
  }
  if (!canonicalRoot) throw new AppError("OUTPUT_OUTSIDE_ALLOWLIST", "Direktori tujuan di luar ALLOWED_OUTPUT_DIRS.");

  const finalPath = path.resolve(canonicalRoot, fileName);
  try {
    const stat = await fs.stat(finalPath);
    if (stat.isDirectory()) throw new AppError("INVALID_OUTPUT_NAME", "Nama output menunjuk ke direktori.");
    if (!overwrite) throw new AppError("OUTPUT_EXISTS", "File output sudah ada. Gunakan overwrite:true untuk mengganti.");
  } catch (error) {
    if (error instanceof AppError) throw error;
    // ENOENT etc: file does not exist yet — allowed.
  }
  try {
    await fs.access(canonicalRoot, fsConstants.W_OK);
  } catch {
    throw new AppError("OUTPUT_DIR_NOT_WRITABLE", "Direktori output tidak dapat ditulis.");
  }
  return { canonicalPath: finalPath, extension, overwrite };
}
