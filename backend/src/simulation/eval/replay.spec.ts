import { reconstructCandidates } from "./replay";
import type { SchedulerPrefs } from "../../scheduler/edf";

/**
 * The replay candidate reconstruction re-runs the pure scheduler core's
 * `feasibleSlots` for a logged decision so the off-policy IPS/SNIPS sees the REAL
 * feasible candidate set (not just the ≤2-element suggested/chosen pair). It is
 * pure + deterministic, so it is unit-tested directly.
 */

const prefs: SchedulerPrefs = {
  workStart: 540, // 09:00
  workEnd: 1020, // 17:00
  workDays: [1, 2, 3, 4, 5], // Mon–Fri
  timezone: "UTC",
};

// 2025-01-06 is a Monday.
const MON_09 = new Date("2025-01-06T09:00:00.000Z");
const MON_11 = new Date("2025-01-06T11:00:00.000Z");

describe("reconstructCandidates", () => {
  it("enumerates the full working-window grid, not just the (suggested, chosen) pair", () => {
    const cs = reconstructCandidates(prefs, 60, null, MON_09, MON_11);
    // A 60-min task on the 15-min grid fits from 09:00 (start) through 16:00
    // (last start that ends ≤ 17:00) → far more than the 2 logged slots.
    expect(cs.length).toBeGreaterThan(2);
    // Both the suggested and chosen slots are present.
    expect(cs.some((c) => c.getTime() === MON_09.getTime())).toBe(true);
    expect(cs.some((c) => c.getTime() === MON_11.getTime())).toBe(true);
    // First feasible start is the Monday 09:00 work-window start.
    expect(cs[0].getTime()).toBe(MON_09.getTime());
    // Monday 16:00 (last 60-min start that fits before 17:00) is enumerated.
    expect(
      cs.some(
        (c) => c.getTime() === new Date("2025-01-06T16:00:00.000Z").getTime(),
      ),
    ).toBe(true);
  });

  it("is sorted ascending and de-duplicated", () => {
    const cs = reconstructCandidates(prefs, 60, null, MON_09, MON_11);
    for (let i = 1; i < cs.length; i++) {
      expect(cs[i].getTime()).toBeGreaterThan(cs[i - 1].getTime());
    }
  });

  it("respects the deadline as a hard ceiling on the candidate set", () => {
    // Deadline at 11:00 → only slots that END by 11:00 survive (09:00 + 09:15…
    // 10:00 starts for a 60-min task), and the 11:00 chosen slot is unioned in.
    const deadline = new Date("2025-01-06T11:00:00.000Z");
    const cs = reconstructCandidates(prefs, 60, deadline, MON_09, MON_11);
    // Enumerated slots must end ≤ deadline; the unioned chosen (11:00) is the
    // only member starting at/after 10:00.
    const enumeratedEndsByDeadline = cs
      .filter((c) => c.getTime() !== MON_11.getTime())
      .every((c) => c.getTime() + 60 * 60_000 <= deadline.getTime());
    expect(enumeratedEndsByDeadline).toBe(true);
    // The chosen slot is still present (unioned in even though it overshoots).
    expect(cs.some((c) => c.getTime() === MON_11.getTime())).toBe(true);
  });

  it("unions in an off-grid suggested/chosen slot so it is never dropped", () => {
    // An out-of-hours chosen slot (08:07, off the 15-min grid + before work
    // start) is not in the enumerated set but must survive in the candidate set.
    const offGrid = new Date("2025-01-06T08:07:00.000Z");
    const cs = reconstructCandidates(prefs, 60, null, MON_09, offGrid);
    expect(cs.some((c) => c.getTime() === offGrid.getTime())).toBe(true);
    expect(cs.some((c) => c.getTime() === MON_09.getTime())).toBe(true);
    // Still sorted: the 08:07 slot sorts ahead of the 09:00 work-window start.
    expect(cs[0].getTime()).toBe(offGrid.getTime());
  });

  it("returns an empty set when neither slot is known", () => {
    expect(reconstructCandidates(prefs, 60, null, null, null)).toEqual([]);
  });

  it("handles a lone known slot (KEEP with only the suggested logged)", () => {
    const cs = reconstructCandidates(prefs, 60, null, MON_09, null);
    expect(cs.some((c) => c.getTime() === MON_09.getTime())).toBe(true);
    expect(cs.length).toBeGreaterThan(1);
  });
});
