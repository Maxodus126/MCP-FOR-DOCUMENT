import { PDFParse } from "pdf-parse";
import { AppError } from "../errors.js";
import { cleanText } from "../utils/text.js";

interface PdfPageLike { num?: number; pageNumber?: number; page?: number; text?: string }
interface PdfTextResultLike { text?: string; total?: number; totalPages?: number; pages?: PdfPageLike[] }
interface PdfInfoResultLike { total?: number; totalPages?: number; numPages?: number; numpages?: number; pages?: unknown[] }
export interface ExtractedPdfPage { page: number; text: string }
export interface ExtractedPdf {
  pages: ExtractedPdfPage[];
  totalPages: number;
  pageMappingAvailable: boolean;
  hasExtractableText: boolean;
}

function positiveInteger(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}
function getTotalPages(info: PdfInfoResultLike, text?: PdfTextResultLike): number {
  return positiveInteger(info.totalPages, info.total, info.numPages, info.numpages, info.pages?.length,
    text?.totalPages, text?.total, text?.pages?.length);
}
function validatePageCount(totalPages: number, maxPages: number): void {
  if (totalPages === 0) throw new AppError("INVALID_PDF", "PDF tidak memiliki metadata halaman yang dapat dibaca atau file rusak.");
  if (totalPages > maxPages) throw new AppError("PDF_PAGE_LIMIT", `PDF memiliki ${totalPages} halaman; batas server ${maxPages} halaman.`);
}
function createPageMapping(rawPages: PdfPageLike[], expectedPages: number[]): ExtractedPdfPage[] | null {
  if (rawPages.length !== expectedPages.length) return null;
  const pages = rawPages.map((raw, index) => ({
    page: positiveInteger(raw.num, raw.pageNumber, raw.page) || expectedPages[index]!,
    text: cleanText(raw.text),
  }));
  const expected = new Set(expectedPages);
  if (pages.some((page) => !expected.has(page.page)) || new Set(pages.map((page) => page.page)).size !== pages.length) return null;
  return pages.sort((a, b) => a.page - b.page);
}

export async function getPdfPageCount(buffer: Buffer, maxPages: number): Promise<number | null> {
  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: buffer });
    // Metadata-only path: never extract every page just to obtain page count.
    const info = await parser.getInfo() as unknown as PdfInfoResultLike;
    const totalPages = getTotalPages(info);
    if (totalPages === 0) return null;
    if (totalPages > maxPages) throw new AppError("PDF_PAGE_LIMIT", `PDF memiliki ${totalPages} halaman; batas server ${maxPages} halaman.`);
    return totalPages;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("PDF_INFO_FAILED", "Metadata PDF gagal dibaca. File mungkin rusak, terenkripsi, atau tidak valid.");
  } finally {
    if (parser) await parser.destroy().catch(() => undefined);
  }
}

export async function extractPdfPages(
  buffer: Buffer,
  maxPages: number,
  range?: { startPage: number; endPage?: number },
): Promise<ExtractedPdf> {
  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: buffer });
    const info = await parser.getInfo() as unknown as PdfInfoResultLike;
    const totalPages = getTotalPages(info);
    validatePageCount(totalPages, maxPages);

    const start = range?.startPage ?? 1;
    const end = range?.endPage ?? totalPages;
    if (start < 1 || end < start || end > totalPages) {
      throw new AppError("INVALID_PAGE_RANGE", `Rentang halaman tidak valid. Total halaman: ${totalPages}.`);
    }
    const requestedPages = Array.from({ length: end - start + 1 }, (_, index) => start + index);

    // pdf-parse v2 supports partial page selection. This avoids materializing text
    // for pages the caller did not request. `as never` keeps compatibility with
    // minor SDK type-definition differences across patch releases.
    const textResult = await parser.getText({ partial: requestedPages } as never) as unknown as PdfTextResultLike;
    const rawPages = Array.isArray(textResult.pages) ? textResult.pages : [];
    const mapped = createPageMapping(rawPages, requestedPages);

    if (!mapped && requestedPages.length !== totalPages) {
      throw new AppError("PAGE_MAPPING_UNAVAILABLE", "Parser tidak dapat memastikan pemetaan halaman untuk rentang yang diminta. Coba baca seluruh dokumen atau gunakan versi parser yang kompatibel.");
    }

    let pages: ExtractedPdfPage[];
    let pageMappingAvailable = mapped !== null;
    if (mapped) {
      pages = mapped;
    } else {
      const fullText = cleanText(textResult.text) || rawPages.map((page) => cleanText(page.text)).join("\n\n");
      const splitPages = fullText.split("\f");
      while (splitPages.length > totalPages && splitPages.at(-1)?.trim() === "") splitPages.pop();
      if (splitPages.length === totalPages) {
        pages = splitPages.map((text, index) => ({ page: index + 1, text }));
        pageMappingAvailable = true;
      } else {
        pages = [{ page: 1, text: fullText }];
        pageMappingAvailable = totalPages === 1;
      }
    }

    return {
      pages,
      totalPages,
      pageMappingAvailable,
      hasExtractableText: pages.some((page) => page.text.trim().length > 20),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("PDF_PARSE_FAILED", "PDF gagal diparsing. Periksa integritas file, enkripsi, dan kompatibilitas PDF.");
  } finally {
    if (parser) await parser.destroy().catch(() => undefined);
  }
}
