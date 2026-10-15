import { describe, expect, it } from "vitest";
import { filterHidden, hideSessions } from "../hidden-sessions";

const s = (id: string, seriesId: string | null, start: string) => ({
  id,
  seriesId,
  scheduledStartTime: start,
});

describe("hidden sessions", () => {
  const list = [
    s("a", null, "2026-10-15T09:00:00Z"),
    s("b", "S", "2026-10-15T10:00:00Z"),
    s("c", "S", "2026-10-16T10:00:00Z"),
  ];

  it("hides one id until undone", () => {
    const undo = hideSessions({ id: "a" });
    expect(filterHidden(list).map((x) => x.id)).toEqual(["b", "c"]);
    undo();
    expect(filterHidden(list)).toBe(list);
  });

  it("hides a series from a start onward", () => {
    const undo = hideSessions({ seriesId: "S", fromISO: "2026-10-16T00:00:00Z" });
    expect(filterHidden(list).map((x) => x.id)).toEqual(["a", "b"]);
    undo();
  });
});
