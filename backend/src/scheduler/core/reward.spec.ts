import { MOVE_REWARD_SCALE_MINUTES } from "../constants";
import { dragDistanceReward } from "./reward";

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
