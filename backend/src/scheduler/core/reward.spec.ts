import { MOVE_REWARD_SCALE_MINUTES } from "../constants";
import {
  OUTCOME_GRACE_MS,
  OUTCOME_MISS_CUTOFF_MS,
} from "../../common/constants";
import { completionReward, dragDistanceReward } from "./reward";

const MIN = 60_000;
const START = 10_000 * MIN;
const END = START + 60 * MIN;
const SETTLE = END + OUTCOME_GRACE_MS;
const CUTOFF = END + OUTCOME_MISS_CUTOFF_MS;

describe("completionReward", () => {
  it("settles a check-off inside the slot as COMPLETED at end + grace", () => {
    expect(completionReward(START, END, START + 5 * MIN, false, SETTLE)).toBe(
      "COMPLETED",
    );
  });

  it("counts a check-off at the exact start", () => {
    expect(completionReward(START, END, START, false, SETTLE)).toBe(
      "COMPLETED",
    );
  });

  it("is unsettled before end + grace even when completed", () => {
    expect(completionReward(START, END, START, false, SETTLE - 1)).toBeNull();
  });

  it("does not count a check-off before the start", () => {
    const early = START - MIN;
    expect(completionReward(START, END, early, false, SETTLE)).toBeNull();
    expect(completionReward(START, END, early, false, CUTOFF)).toBe("MISSED");
  });

  it("settles a skip as SKIPPED at end + grace, even with a completion stamp", () => {
    expect(completionReward(START, END, START + MIN, true, SETTLE)).toBe(
      "SKIPPED",
    );
    expect(completionReward(START, END, null, true, SETTLE)).toBe("SKIPPED");
  });

  it("stays unsettled without a check-off until the cutoff", () => {
    expect(completionReward(START, END, null, false, SETTLE)).toBeNull();
    expect(completionReward(START, END, null, false, CUTOFF - 1)).toBeNull();
  });

  it("settles a placement with no check-off as MISSED at the cutoff", () => {
    expect(completionReward(START, END, null, false, CUTOFF)).toBe("MISSED");
  });

  it("is unsettled before end + grace for a skip", () => {
    expect(completionReward(START, END, null, true, END)).toBeNull();
  });
});

describe("dragDistanceReward", () => {
  it("returns 0 for a zero-distance move", () => {
    expect(dragDistanceReward(0)).toBe(0);
  });

  it("grades a mid-range displacement linearly", () => {
    expect(dragDistanceReward(120)).toBe(-0.5);
  });

  it("is symmetric around zero displacement", () => {
    expect(dragDistanceReward(-120)).toBe(-0.5);
  });

  it("saturates at -1 once the scale is reached", () => {
    expect(dragDistanceReward(MOVE_REWARD_SCALE_MINUTES)).toBe(-1);
    expect(dragDistanceReward(MOVE_REWARD_SCALE_MINUTES * 4)).toBe(-1);
  });
});
