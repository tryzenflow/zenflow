import { describe, expect, it } from "vitest";
import { highlightParts } from "../highlight";
describe("highlightParts", () => {
  it("returns the whole title when the query is empty", () => {
    expect(highlightParts("OOP essay", "")).toEqual([
      { text: "OOP essay", match: false },
    ]);
  });

  it("marks case-insensitive matches", () => {
    expect(highlightParts("OOP Essay", "essay")).toEqual([
      { text: "OOP ", match: false },
      { text: "Essay", match: true },
    ]);
  });

  it("marks every word of the query", () => {
    expect(highlightParts("Giải tích 2 bài tập", "tích bài")).toEqual([
      { text: "Giải ", match: false },
      { text: "tích", match: true },
      { text: " 2 ", match: false },
      { text: "bài", match: true },
      { text: " tập", match: false },
    ]);
  });

  it("matches Vietnamese text typed in composed form", () => {
    const decomposed = "Ôn tập".normalize("NFD");
    const parts = highlightParts(decomposed, "ôn");
    expect(parts[0]).toEqual({ text: "Ôn", match: true });
  });

  it("escapes regex characters in the query", () => {
    expect(highlightParts("C++ (lab)", "c++ (")).toEqual([
      { text: "C++", match: true },
      { text: " ", match: false },
      { text: "(", match: true },
      { text: "lab)", match: false },
    ]);
  });
});
