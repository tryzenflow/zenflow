import { describe, expect, it } from "vitest";
import { formatBytes } from "../file-size";

describe("formatBytes", () => {
  it("is short and human", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(4300)).toBe("4.2 KB");
    expect(formatBytes(15 * 1024)).toBe("15 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
  it("returns nothing for junk", () => {
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
  });
});
