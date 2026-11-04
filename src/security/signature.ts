import { AppError } from "../errors.js";

function containsPdfHeader(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1_024)).includes(Buffer.from("%PDF-", "ascii"));
}

export function validateFileSignature(buffer: Buffer, extension: string): void {
  if (buffer.length === 0) {
    if (extension === ".csv") return;
    throw new AppError("EMPTY_FILE", "File kosong.");
  }
  if (extension === ".pdf" && !containsPdfHeader(buffer)) {
    throw new AppError("FILE_SIGNATURE_MISMATCH", "Ekstensi PDF tidak sesuai dengan signature file.");
  }
  if ((extension === ".docx" || extension === ".xlsx") &&
      !(buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50)) {
    throw new AppError("FILE_SIGNATURE_MISMATCH", "DOCX/XLSX harus berupa arsip ZIP Office yang valid.");
  }
  if (extension === ".csv") {
    const isUtf16 = buffer.length >= 2 &&
      ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff));
    const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
    if (!isUtf16 && sample.includes(0)) {
      throw new AppError("FILE_SIGNATURE_MISMATCH", "CSV tampak seperti file biner atau encoding tidak didukung.");
    }
  }
}
