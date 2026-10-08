import { describe, expect, it } from "vitest";
import { centeredDays, jumpWindow } from "../week-date-math";

const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("jumpWindow", () => {
  const focused = day(2026, 10, 8);
  const win = centeredDays(focused);

  it("puts a later target in the next slot and slides to index 2", () => {
    const target = day(2026, 10, 12);
    const r = jumpWindow(win, focused, target, key);
    expect(r.toIndex).toBe(2);
    expect(r.window).toEqual([win[0], focused, target]);
  });

  it("puts an earlier target in the previous slot and slides to index 0", () => {
    const target = day(2026, 9, 2);
    const r = jumpWindow(win, focused, target, key);
    expect(r.toIndex).toBe(0);
    expect(r.window).toEqual([target, focused, win[2]]);
  });

  it("orders across a year boundary", () => {
    const f = day(2026, 12, 30);
    const r = jumpWindow(centeredDays(f), f, day(2027, 1, 3), key);
    expect(r.toIndex).toBe(2);
  });
});
