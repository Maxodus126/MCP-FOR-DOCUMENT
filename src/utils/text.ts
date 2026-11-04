export interface TruncateResult { text: string; truncated: boolean; }

export function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\0/g, "").replace(/\r\n?/g, "\n");
}

export function truncateText(value: string, maxChars: number): TruncateResult {
  const cleaned = cleanText(value);
  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false };
  const marker = "\n[OUTPUT DIPOTONG — gunakan rentang lebih kecil atau naikkan batas output]";
  if (maxChars <= marker.length) return { text: cleaned.slice(0, maxChars), truncated: true };
  return { text: `${cleaned.slice(0, maxChars - marker.length)}${marker}`, truncated: true };
}

export function normalizeSearchText(value: string): string {
  return cleanText(value).normalize("NFKC").toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim();
}

export function makeSnippet(text: string, query: string, maxChars = 1_000): string {
  const normalized = cleanText(text).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const normalizedText = normalizeSearchText(normalized);
  const normalizedQuery = normalizeSearchText(query);
  let index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) {
    const firstTerm = normalizedQuery.split(/\s+/).find(Boolean) ?? "";
    index = normalizedText.indexOf(firstTerm);
  }
  if (index < 0) index = 0;
  const start = Math.max(0, index - Math.floor(maxChars / 3));
  const end = Math.min(normalized.length, start + maxChars);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}
