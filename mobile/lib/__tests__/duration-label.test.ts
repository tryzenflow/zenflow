import { afterEach, describe, expect, it } from "vitest";
import { durationLabel } from "../duration-label";
import { setLanguage } from "../i18n";

afterEach(() => setLanguage("en"));

describe("durationLabel", () => {
  it("matches the English wording", () => {
    setLanguage("en");
    expect(durationLabel(30)).toBe("30 min");
    expect(durationLabel(60)).toBe("1 h");
    expect(durationLabel(90)).toBe("1 h 30 min");
    expect(durationLabel(0)).toBe("0 min");
  });
  it("is fully translated in Vietnamese", () => {
    setLanguage("vi");
    expect(durationLabel(90)).toBe("1 giờ 30 phút");
    expect(durationLabel(120)).toBe("2 giờ");
  });
});
