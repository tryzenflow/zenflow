import {
  DURATION_DIVISOR,
  minMaxSigned,
  WORKLOAD_COUNT_DIVISOR,
  WORKLOAD_HOURS_DIVISOR,
} from "./normalize";

describe("minMaxSigned", () => {
  it("maps 0 to -1 and the divisor to +1", () => {
    expect(minMaxSigned(0, 90)).toBe(-1);
    expect(minMaxSigned(90, 90)).toBe(1);
  });

  it("maps the midpoint to 0", () => {
    expect(minMaxSigned(45, 90)).toBeCloseTo(0);
    expect(minMaxSigned(DURATION_DIVISOR / 2, DURATION_DIVISOR)).toBeCloseTo(0);
  });

  it("clamps out-of-range inputs", () => {
    expect(minMaxSigned(1000, 90)).toBe(1);
    expect(minMaxSigned(-5, 90)).toBe(-1);
  });

  it("normalizes workload divisors as documented", () => {
    expect(minMaxSigned(WORKLOAD_HOURS_DIVISOR, WORKLOAD_HOURS_DIVISOR)).toBe(
      1,
    );
    expect(minMaxSigned(WORKLOAD_COUNT_DIVISOR, WORKLOAD_COUNT_DIVISOR)).toBe(
      1,
    );
  });
});
