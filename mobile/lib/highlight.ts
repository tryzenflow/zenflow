export interface HighlightPart {
  text: string;
  match: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lowercase, accent-free copy of `text` with the same length, so indices carry back. */
function fold(text: string): string {
  let out = "";
  for (const unit of text.normalize("NFC")) {
    const base = unit
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase();
    out += base.length === unit.length ? base : unit.toLowerCase();
  }
  return out;
}

/**
 * Split `text` into runs, marking every case- and accent-insensitive occurrence
 * of each whitespace-separated word in `query` ("phat" marks "Phát").
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const words = fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (words.length === 0 || text.length === 0) {
    return [{ text, match: false }];
  }
  const pattern = new RegExp(
    `(${words.map((w) => escapeRegExp(w)).join("|")})`,
    "gu",
  );
  const source = text.normalize("NFC");
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const m of fold(source).matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: source.slice(last, start), match: false });
    parts.push({ text: source.slice(start, start + m[0].length), match: true });
    last = start + m[0].length;
  }
  if (last < source.length) parts.push({ text: source.slice(last), match: false });
  return parts;
}
