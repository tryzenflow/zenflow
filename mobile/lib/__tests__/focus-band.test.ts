import { FOCUS_BANDS } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { FOCUS_BAND_HOURS, focusBandOptions } from "../focus-band";

describe("focusBandOptions", () => {
  it("lists every shared band, in order", () => {
    expect(focusBandOptions().map((o) => o.band)).toEqual([...FOCUS_BANDS]);
  });
  it("gives each band its label and hour range", () => {
    expect(focusBandOptions()).toEqual([
      { band: "MORNING", label: "Morning", hours: "08:00 to 12:00" },
      { band: "AFTERNOON", label: "Afternoon", hours: "12:00 to 17:00" },
      { band: "EVENING", label: "Evening", hours: "17:00 to 21:00" },
      { band: "LATE_NIGHT", label: "Late night", hours: "21:00 to 02:00" },
    ]);
  });
  it("keeps the late night band across midnight", () => {
    expect(FOCUS_BAND_HOURS.LATE_NIGHT).toEqual({ from: "21:00", to: "02:00" });
  });
});
