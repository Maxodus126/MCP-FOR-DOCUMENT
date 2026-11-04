export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export interface PublicError {
  code: string;
  message: string;
}

export function toPublicError(error: unknown): PublicError {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : "";
  switch (code) {
    case "ENOENT": return { code: "FILE_NOT_FOUND", message: "File tidak ditemukan." };
    case "EACCES":
    case "EPERM": return { code: "FILE_ACCESS_DENIED", message: "Sistem operasi menolak akses ke file." };
    case "ELOOP": return { code: "SYMLINK_NOT_ALLOWED", message: "Akses melalui symbolic link tidak diizinkan." };
    case "EMFILE":
    case "ENFILE": return { code: "RESOURCE_LIMIT", message: "Server kehabisan file descriptor sementara. Coba kembali nanti." };
    case "EFBIG": return { code: "FILE_TOO_LARGE", message: "Ukuran file melebihi batas pemrosesan." };
    case "ABORT_ERR": return { code: "REQUEST_CANCELLED", message: "Permintaan dibatalkan oleh MCP client." };
    default: return { code: "PROCESSING_FAILED", message: "Dokumen gagal diproses. Periksa format file dan coba kembali." };
  }
}
