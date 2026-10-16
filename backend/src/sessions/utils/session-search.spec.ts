import {
  comparePositions,
  decodeCursor,
  encodeCursor,
  isPast,
  likePattern,
  mergePage,
  searchTerms,
} from "./session-search";

const at = (iso: string, id: string) => ({ start: new Date(iso), id });

describe("session search helpers", () => {
  it("round-trips a cursor", () => {
    const p = at("2026-08-01T09:00:00.000Z", "abc");
    expect(decodeCursor(encodeCursor(p))).toEqual(p);
  });

  it("rejects a malformed cursor", () => {
    expect(decodeCursor("not-json")).toBeNull();
    expect(
      decodeCursor(Buffer.from('{"s":"x","id":"a"}').toString("base64url")),
    ).toBeNull();
  });

  it("orders by start then id, the anchor's empty id first", () => {
    const anchor = at("2026-08-01T09:00:00.000Z", "");
    const same = at("2026-08-01T09:00:00.000Z", "a");
    expect(comparePositions(anchor, same)).toBeLessThan(0);
    expect(isPast(same, anchor, "forward")).toBe(true);
    expect(isPast(same, anchor, "backward")).toBe(false);
  });

  it("splits, lowercases and dedupes terms", () => {
    expect(searchTerms("  Lab  lab Report ")).toEqual(["lab", "report"]);
    expect(searchTerms(undefined)).toEqual([]);
  });

  it("escapes LIKE wildcards", () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });

  it("merges stored rows and occurrences in walk order", () => {
    const stored = [at("2026-08-01T00:00:00Z", "s1")];
    const occ = [
      at("2026-07-01T00:00:00Z", "o1"),
      at("2026-09-01T00:00:00Z", "o2"),
    ];
    const fwd = mergePage(stored, occ, 2, "forward", false);
    expect(fwd.page.map((p) => p.id)).toEqual(["o1", "s1"]);
    expect(fwd.hasMore).toBe(true);
    const back = mergePage(stored, occ, 3, "backward", false);
    expect(back.page.map((p) => p.id)).toEqual(["o2", "s1", "o1"]);
    expect(back.hasMore).toBe(false);
  });
});
