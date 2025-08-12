import { generateOTP } from "./generate-otp";

describe("generateOTP", () => {
  test("returns 6-digit OTP by default", () => {
    const otp = generateOTP();
    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });

  test("returns OTP of custom length", () => {
    const otp = generateOTP(4);
    expect(otp).toHaveLength(4);
    expect(/^\d{4}$/.test(otp)).toBe(true);
  });

  test("returns numeric OTP only", () => {
    const otp = generateOTP(8);
    expect(/^\d{8}$/.test(otp)).toBe(true);
  });

  test("returns empty string when length is 0", () => {
    const otp = generateOTP(0);
    expect(otp).toBe("");
  });

  test("returns different OTPs on multiple calls", () => {
    const otp1 = generateOTP();
    const otp2 = generateOTP();
    expect(otp1).not.toBe(otp2); // very small chance of collision
  });
});
