export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/**
 * Parses a single-range `Range: bytes=…` header against a file of `size` bytes.
 * `null` means "serve the whole file" (no header, or a form we ignore, like
 * several ranges); `"unsatisfiable"` is a 416. Media players (iOS especially)
 * will not play a video unless the server honours these requests.
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (m[1] === "" && m[2] === "") || size <= 0) return null;
  if (m[1] === "") {
    // Suffix: the last N bytes.
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return "unsatisfiable";
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return end < start ? "unsatisfiable" : { start, end };
}
