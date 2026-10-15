import { beforeEach, describe, expect, it, vi } from "vitest";
import { slotPick } from "@/api/tasks";
import {
  chooseOtherTime,
  forgetAlternative,
  rememberPlacement,
  useSlotAlternativeStore,
} from "../slot-alternatives";

vi.mock("@/api/tasks", () => ({ slotPick: vi.fn() }));

const PRIMARY = "2026-10-15T03:00:00.000Z";
const ALTERNATIVE = "2026-10-15T06:00:00.000Z";
const byId = () => useSlotAlternativeStore.getState().byId;

const divergent = (id: string) => ({
  id,
  divergent: true,
  slotProposalId: `sp-${id}`,
  primarySlot: PRIMARY,
  alternativeSlot: ALTERNATIVE,
});

beforeEach(() => {
  useSlotAlternativeStore.setState({ byId: {} });
  vi.mocked(slotPick).mockReset();
});

describe("rememberPlacement", () => {
  it("records the alternative of a divergent placement", () => {
    rememberPlacement(divergent("t1"));
    expect(byId().t1).toEqual({
      slotProposalId: "sp-t1",
      primarySlot: PRIMARY,
      alternativeSlot: ALTERNATIVE,
    });
  });

  it("clears an earlier alternative once the placement is no longer divergent", () => {
    rememberPlacement(divergent("t1"));
    rememberPlacement({ id: "t1", divergent: false, slotProposalId: null });
    expect(byId().t1).toBeUndefined();
  });

  it("records each divergent sitting of a series and skips the rest", () => {
    rememberPlacement({
      id: "s1",
      divergent: false,
      sessions: [
        { id: "s1", divergent: false },
        divergent("s2"),
        { id: "s3", divergent: true, slotProposalId: null, primarySlot: PRIMARY, alternativeSlot: ALTERNATIVE },
      ],
    });
    expect(Object.keys(byId())).toEqual(["s2"]);
  });

  it("ignores a divergent flag without a proposal to record against", () => {
    rememberPlacement({ id: "t1", divergent: true, slotProposalId: null, primarySlot: PRIMARY, alternativeSlot: ALTERNATIVE });
    expect(byId().t1).toBeUndefined();
  });
});

describe("forgetAlternative", () => {
  it("drops only the named session", () => {
    rememberPlacement(divergent("t1"));
    rememberPlacement(divergent("t2"));
    forgetAlternative("t1");
    expect(Object.keys(byId())).toEqual(["t2"]);
  });
});

describe("chooseOtherTime", () => {
  it("applies the alternative under its proposal and forgets it", async () => {
    rememberPlacement(divergent("t1"));
    vi.mocked(slotPick).mockResolvedValue({
      session: { id: "t1" } as never,
      chosenByUser: "alternative",
    });

    const picked = await chooseOtherTime("t1");

    expect(slotPick).toHaveBeenCalledWith("t1", {
      slotProposalId: "sp-t1",
      chose: "alternative",
    });
    expect(picked?.chosenByUser).toBe("alternative");
    expect(byId().t1).toBeUndefined();
  });

  it("keeps the alternative when the swap fails, so it can be retried", async () => {
    rememberPlacement(divergent("t1"));
    vi.mocked(slotPick).mockRejectedValue(new Error("boom"));

    await expect(chooseOtherTime("t1")).rejects.toThrow("boom");
    expect(byId().t1).toBeDefined();
  });

  it("does nothing when no alternative is offered", async () => {
    expect(await chooseOtherTime("t9")).toBeNull();
    expect(slotPick).not.toHaveBeenCalled();
  });
});
