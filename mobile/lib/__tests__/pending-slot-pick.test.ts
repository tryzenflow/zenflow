import type { Session } from "@zenflow/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  type PendingSlotPick,
  setPendingSlotPick,
  takePendingSlotPick,
} from "../pending-slot-pick";

const pick = (overrides: Partial<PendingSlotPick> = {}): PendingSlotPick => ({
  session: { id: "s1", title: "Essay", durationMinutes: 60 } as Session,
  primarySlot: "2026-09-23T09:00:00.000Z",
  alternativeSlot: "2026-09-24T14:00:00.000Z",
  slotProposalId: "p1",
  tz: "Asia/Ho_Chi_Minh",
  ...overrides,
});

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
    expect(takePendingSlotPick()?.slotProposalId).toBe("second");
  });
});