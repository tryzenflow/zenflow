import { parseByteRange } from "./byte-range";

describe("parseByteRange", () => {
  it("reads open, closed and suffix ranges", () => {
    expect(parseByteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });

  it("ignores what it can't use and rejects what can't be served", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseByteRange("items=0-1", 100)).toBeNull();
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=20-10", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});
