export interface HighlightPart {
  text: string;
  match: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Split `text` into runs, marking every case-insensitive occurrence of each
 * whitespace-separated word in `query`. Matching is on the original string, so
 * indices stay valid for Vietnamese diacritics and mixed case.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const words = query
    .normalize("NFC")
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (words.length === 0 || text.length === 0) {
    return [{ text, match: false }];
  }
  const pattern = new RegExp(
    `(${words.map((w) => escapeRegExp(w)).join("|")})`,
    "giu",
  );
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const m of text.normalize("NFC").matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}
