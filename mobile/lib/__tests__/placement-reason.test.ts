import type { PlacementReason } from "@zenflow/shared";
import { afterEach, describe, expect, it } from "vitest";
import { getLanguage, setLanguage } from "../i18n";
import {
  PLACEMENT_REASON_KEYS,
  placementReasonLine,
} from "../placement-reason";

const TZ = "Asia/Ho_Chi_Minh";
// 14:00Z is 21:00 in UTC+7.
const START = "2026-10-15T14:00:00.000Z";
const REASONS = Object.keys(PLACEMENT_REASON_KEYS) as PlacementReason[];

afterEach(() => {
  setLanguage("en");
});

describe("placementReasonLine", () => {
  it("has no line without a reason", () => {
    expect(placementReasonLine(null, START, TZ)).toBeNull();
    expect(placementReasonLine(undefined, START, TZ)).toBeNull();
  });

  it("reads the example line in English", () => {
    setLanguage("en");
    expect(placementReasonLine("PREFERRED_HOUR", START, TZ)).toBe(
      "Placed at 9:00 PM, you usually study then",
    );
  });

  it("gives every reason an English line naming the start", () => {
    setLanguage("en");
    for (const reason of REASONS) {
      expect(placementReasonLine(reason, START, TZ)).toMatch(
        /^Placed at 9:00 PM, /,
      );
    }
  });

  it("localizes every reason into Vietnamese", () => {
    setLanguage("vi");
    expect(placementReasonLine("PREFERRED_HOUR", START, TZ)).toBe(
      "Đã xếp lúc 21:00, bạn thường học vào giờ này",
    );
    for (const reason of REASONS) {
      const line = placementReasonLine(reason, START, TZ);
      expect(line).toContain("21:00");
      expect(line).not.toMatch(/^Placed/);
    }
  });

  it("keeps copy free of separators", () => {
    setLanguage("vi");
    for (const reason of REASONS) {
      expect(placementReasonLine(reason, START, TZ)).not.toMatch(/[·—–|→]/);
    }
    expect(getLanguage()).toBe("vi");
  });
});
