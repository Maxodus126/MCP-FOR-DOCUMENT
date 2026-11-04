import { makeSnippet, normalizeSearchText } from "./text.js";

export interface SearchUnit { location: string; text: string; }
export interface RankedMatch { location: string; snippet: string; score: number; }

/** Phrase matches rank above all-token matches; result payloads contain snippets only. */
export function rankMatches(units: SearchUnit[], query: string, maxResults: number): RankedMatch[] {
  const needle = normalizeSearchText(query);
  const terms = [...new Set(needle.split(/\s+/).filter(Boolean))];
  const candidates: Array<{ location: string; text: string; score: number; order: number }> = [];
  units.forEach((unit, order) => {
    const normalized = normalizeSearchText(unit.text);
    if (!normalized || terms.length === 0) return;
    const matchedTerms = terms.filter((term) => normalized.includes(term));
    if (matchedTerms.length !== terms.length) return;
    const phrase = normalized.includes(needle);
    const occurrences = phrase
      ? normalized.split(needle).length - 1
      : matchedTerms.reduce((sum, term) => sum + Math.max(1, normalized.split(term).length - 1), 0);
    candidates.push({ location: unit.location, text: unit.text, score: (phrase ? 1_000 : 500) + Math.min(occurrences, 100), order });
  });
  return candidates.sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, maxResults)
    .map(({ location, text, score }) => ({ location, snippet: makeSnippet(text, query), score }));
}
