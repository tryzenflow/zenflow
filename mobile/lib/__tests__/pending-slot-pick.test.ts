import type { Session } from "@zenflow/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  type PendingSlotPick,
  setPendingSlotPick,
  takePendingSlotPick,
} from "../pending-slot-pick";

const pick = (
  overrides: Partial<Extract<PendingSlotPick, { kind: "single" }>> = {},
): PendingSlotPick =>
  ({
    kind: "single",
    session: { id: "s1", title: "Essay", durationMinutes: 60 } as Session,
    primarySlot: "2026-09-23T09:00:00.000Z",
    alternativeSlot: "2026-09-24T14:00:00.000Z",
    slotProposalId: "p1",
    tz: "Asia/Ho_Chi_Minh",
    ...overrides,
  }) as PendingSlotPick;

const series = (overrides: Partial<Extract<PendingSlotPick, { kind: "series" }>> = {}) =>
  ({
    kind: "series",
    title: "Algorithms",
    sittings: [],
    tz: "Asia/Ho_Chi_Minh",
    ...overrides,
  }) as PendingSlotPick;

afterEach(() => {
  takePendingSlotPick();
});

describe("pending slot pick", () => {
  it("is empty until something is set", () => {
    expect(takePendingSlotPick()).toBeNull();
  });

  it("round-trips a pick and clears it, so it fires exactly once", () => {
    setPendingSlotPick(pick());
    expect(takePendingSlotPick()).toEqual(pick());
    expect(takePendingSlotPick()).toBeNull();
  });

  it("is last-write-wins when set twice before it is consumed", () => {
    setPendingSlotPick(pick({ slotProposalId: "first" }));
    setPendingSlotPick(pick({ slotProposalId: "second" }));
    const taken = takePendingSlotPick();
    expect(taken?.kind).toBe("single");
    expect(
      taken?.kind === "single" ? taken.slotProposalId : null,
    ).toBe("second");
  });

  it("round-trips a series pick", () => {
    const s = series({ title: "Study for Algorithms Final" });
    setPendingSlotPick(s);
    expect(takePendingSlotPick()).toEqual(s);
    expect(takePendingSlotPick()).toBeNull();
  });

  it("lets a series pick supersede a pending single one", () => {
    setPendingSlotPick(pick());
    setPendingSlotPick(series());
    expect(takePendingSlotPick()?.kind).toBe("series");
  });

  it("lets a single pick supersede a pending series one", () => {
    setPendingSlotPick(series());
    setPendingSlotPick(pick());
    expect(takePendingSlotPick()?.kind).toBe("single");
  });
});
