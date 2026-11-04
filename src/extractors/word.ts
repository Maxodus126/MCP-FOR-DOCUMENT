import mammoth from "mammoth";
import TurndownService from "turndown";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { inspectOfficeArchive } from "../security/zip-guard.js";
import { cleanText } from "../utils/text.js";

export interface ExtractedWord { markdown: string; paragraphs: string[]; warnings: string[]; }

function safeLink(href: string | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  // Relative links may refer to a document-internal anchor; do not expose file:/javascript:/data:.
  if (/^#[A-Za-z0-9_.:-]+$/.test(trimmed)) return trimmed;
  return null;
}

function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  turndown.addRule("safe-links", {
    filter: "a",
    replacement: (content, node) => {
      const href = safeLink((node as Element).getAttribute("href"));
      return href ? `[${content || "tautan"}](${href})` : content;
    },
  });
  turndown.addRule("accessible-tables", {
    filter: "table",
    replacement: (_content, node) => {
      const table = node as Element;
      const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) => cleanText(cell.textContent).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim()),
      );
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
      const header = normalized[0] ?? [];
      const body = normalized.slice(1).map((row) => `| ${row.join(" | ")} |`);
      return `\n\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n${body.join("\n")}\n\n`;
    },
  });
  turndown.addRule("image-placeholder", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = (node as HTMLImageElement).getAttribute("alt")?.trim();
      return `\n\n[${cleanText(alt) || "Gambar di dokumen; konten visual tidak diekstrak"}]\n\n`;
    },
  });
  return cleanText(turndown.turndown(html)).trim();
}

export async function extractWordContent(buffer: Buffer, config: AppConfig): Promise<ExtractedWord> {
  try {
    inspectOfficeArchive(buffer, config, "docx");
    const conversionOptions = {
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "", alt: "Gambar di dokumen; konten visual tidak diekstrak" })),
    };
    const [htmlResult, textResult] = await Promise.all([
      mammoth.convertToHtml({ buffer }, conversionOptions),
      mammoth.extractRawText({ buffer }),
    ]);
    const markdown = htmlToMarkdown(htmlResult.value);
    const paragraphs = cleanText(textResult.value).split(/\n+/).map((value) => value.trim()).filter(Boolean);
    if (!markdown && paragraphs.length === 0) throw new AppError("EMPTY_DOCUMENT", "Dokumen Word tidak memiliki teks yang dapat diekstrak.");
    const warnings = htmlResult.messages.filter((message) => message.type === "warning").slice(0, 10)
      .map(() => "Sebagian elemen DOCX tidak dapat dikonversi sepenuhnya oleh Mammoth.");
    return { markdown: markdown || paragraphs.join("\n\n"), paragraphs, warnings: [...new Set(warnings)] };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("DOCX_PARSE_FAILED", "Dokumen Word gagal diproses. Pastikan file DOCX valid, tidak rusak, dan tidak melampaui batas kompleksitas.");
  }
}
