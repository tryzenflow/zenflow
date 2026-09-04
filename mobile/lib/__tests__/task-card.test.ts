import { describe, expect, it } from "vitest";
import { deriveState, withOverlap } from "../task-card";

describe("deriveState", () => {
  it("maps each session type to its own colour state", () => {
    expect(deriveState({ type: "TASK" })).toBe("fluid");
    expect(deriveState({ type: "ASSIGNMENT" })).toBe("assignment");
    expect(deriveState({ type: "EXAM" })).toBe("exam");
    expect(deriveState({ type: "LECTURE" })).toBe("lecture");
    expect(deriveState({ type: "DND" })).toBe("dnd");
  });

  it("does not special-case a past-deadline session (no 'overdue' state)", () => {
    // A TASK is "fluid" regardless of how its deadline relates to now — the
    // 'overdue' visual state was removed.
    expect(deriveState({ type: "TASK" })).toBe("fluid");
  });
});

describe("withOverlap", () => {
  it("folds an overlap into conflict for a fluid card", () => {
    expect(withOverlap("fluid", true)).toBe("conflict");
  });

  it("folds an overlap into conflict for a fixed-type card", () => {
    expect(withOverlap("exam", true)).toBe("conflict");
    expect(withOverlap("lecture", true)).toBe("conflict");
    expect(withOverlap("assignment", true)).toBe("conflict");
  });

  it("leaves a non-overlapping card's state alone", () => {
    expect(withOverlap("fluid", false)).toBe("fluid");
    expect(withOverlap("exam", false)).toBe("exam");
  });

  it("never flags a DND card as conflicting, even if it overlaps", () => {
    expect(withOverlap("dnd", true)).toBe("dnd");
  });
});
