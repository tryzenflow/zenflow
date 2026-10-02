import type { SeriesSession } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { divergentSittings, undecidedSittingIds } from "../series-alternatives";

const sitting = (o: Partial<SeriesSession> & { id: string }): SeriesSession =>
  ({
    sessionIndex: 1,
    sessionTotal: 3,
    slotProposalId: "sp-1",
    primarySlot: "2026-06-30T01:00:00.000Z",
    alternativeSlot: "2026-06-30T05:00:00.000Z",
    divergent: true,
    ...o,
  }) as SeriesSession;

describe("divergentSittings", () => {
  it("is empty when the response carries no sessions", () => {
    expect(divergentSittings(undefined)).toEqual([]);
    expect(divergentSittings([])).toEqual([]);
  });

  it("is empty when nothing diverges (AC: no prompt, behaviour unchanged)", () => {
    const sessions = [
      sitting({ id: "a", divergent: false, alternativeSlot: null }),
      sitting({ id: "b", divergent: false, alternativeSlot: null }),
    ];
    expect(divergentSittings(sessions)).toEqual([]);
  });

  it("lifts the three fields a pick needs off a divergent sitting", () => {
    const [d] = divergentSittings([sitting({ id: "a", sessionIndex: 2 })]);
    expect(d).toMatchObject({
      slotProposalId: "sp-1",
      primarySlot: "2026-06-30T01:00:00.000Z",
      alternativeSlot: "2026-06-30T05:00:00.000Z",
      index: 2,
      total: 3,
    });
    expect(d.session.id).toBe("a");
  });

  it("drops a divergent entry with no slotProposalId (nothing to record against)", () => {
    expect(divergentSittings([sitting({ id: "a", slotProposalId: null })])).toEqual([]);
  });

  it("drops a divergent entry with no primarySlot", () => {
    expect(divergentSittings([sitting({ id: "a", primarySlot: null })])).toEqual([]);
  });

  it("drops a divergent entry with no alternativeSlot", () => {
    expect(divergentSittings([sitting({ id: "a", alternativeSlot: null })])).toEqual([]);
  });

  it("sorts by sessionIndex, not array order", () => {
    const sessions = [
      sitting({ id: "c", sessionIndex: 3 }),
      sitting({ id: "a", sessionIndex: 1 }),
      sitting({ id: "b", sessionIndex: 2 }),
    ];
    expect(divergentSittings(sessions).map((d) => d.session.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps only the divergent sittings of a mixed series", () => {
    const sessions = [
      sitting({ id: "a", sessionIndex: 1 }),
      sitting({ id: "b", sessionIndex: 2, divergent: false, alternativeSlot: null }),
      sitting({ id: "c", sessionIndex: 3 }),
    ];
    expect(divergentSittings(sessions).map((d) => d.session.id)).toEqual(["a", "c"]);
  });

  it("keeps all divergent sittings in session-index order", () => {
    const sessions = [
      sitting({ id: "d", sessionIndex: 4 }),
      sitting({ id: "b", sessionIndex: 2 }),
      sitting({ id: "e", sessionIndex: 5 }),
      sitting({ id: "a", sessionIndex: 1 }),
      sitting({ id: "c", sessionIndex: 3 }),
    ];
    expect(divergentSittings(sessions).map((d) => d.session.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
});

describe("undecidedSittingIds", () => {
  it("targets every sitting when none has a recorded choice", () => {
    expect(
      undecidedSittingIds([
        { id: "a", decided: false },
        { id: "b", decided: false },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("excludes already-decided sittings after a partial bulk success", () => {
    expect(
      undecidedSittingIds([
        { id: "a", decided: true },
        { id: "b", decided: false },
        { id: "c", decided: true },
      ]),
    ).toEqual(["b"]);
  });

  it("is empty when every sitting is decided, so keep-all just closes", () => {
    expect(
      undecidedSittingIds([
        { id: "a", decided: true },
        { id: "b", decided: true },
      ]),
    ).toEqual([]);
  });
});
