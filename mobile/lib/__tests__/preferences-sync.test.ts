import { describe, expect, it } from "vitest";
import {
  deviceZoneDrift,
  modeForTimezone,
  patchToUpdateInput,
  storedMode,
  timezonePickerValue,
  userToSyncedPrefs,
} from "../preferences-sync";

const DEVICE = "Asia/Tokyo";
const user = {
  timezone: "Asia/Ho_Chi_Minh",
  lang: "vi" as const,
  defaultReminderMinutes: 15 as const,
};

describe("patchToUpdateInput", () => {
  it("maps UI names to API names", () => {
    expect(
      patchToUpdateInput({ language: "en", defaultReminder: 30 }, DEVICE),
    ).toEqual({ lang: "en", defaultReminderMinutes: 30 });
  });
  it("resolves the device sentinel to the concrete zone", () => {
    expect(patchToUpdateInput({ timezone: "device" }, DEVICE)).toEqual({
      timezone: DEVICE,
    });
  });
  it("passes explicit zones through and keeps reminder 0", () => {
    expect(
      patchToUpdateInput({ timezone: "UTC", defaultReminder: 0 }, DEVICE),
    ).toEqual({ timezone: "UTC", defaultReminderMinutes: 0 });
  });
  it("omits untouched fields", () => {
    expect(patchToUpdateInput({}, DEVICE)).toEqual({});
  });
});

describe("modeForTimezone", () => {
  it("derives mode", () => {
    expect(modeForTimezone("device")).toBe("device");
    expect(modeForTimezone("UTC")).toBe("explicit");
    expect(modeForTimezone(undefined)).toBeUndefined();
  });
});

describe("userToSyncedPrefs", () => {
  it("takes values from the server user", () => {
    expect(userToSyncedPrefs(user, "explicit")).toEqual({
      language: "vi",
      timezone: "Asia/Ho_Chi_Minh",
      timezoneMode: "explicit",
      defaultReminder: 15,
    });
  });
});

describe("deviceZoneDrift", () => {
  it("returns device zone when device mode and server differs", () => {
    expect(deviceZoneDrift(user, "device", DEVICE)).toBe(DEVICE);
  });
  it("returns null when in sync or explicit", () => {
    expect(deviceZoneDrift({ timezone: DEVICE }, "device", DEVICE)).toBeNull();
    expect(deviceZoneDrift(user, "explicit", DEVICE)).toBeNull();
  });
});

describe("storedMode", () => {
  it("honours stored mode", () => {
    expect(storedMode({ timezoneMode: "explicit", timezone: "UTC" })).toBe(
      "explicit",
    );
  });
  it("migrates legacy values", () => {
    expect(storedMode({ timezone: "device" })).toBe("device");
    expect(storedMode({ timezone: "Europe/Paris" })).toBe("explicit");
    expect(storedMode({})).toBe("device");
  });
});

describe("timezonePickerValue", () => {
  it("highlights device or the explicit zone", () => {
    const p = userToSyncedPrefs(user, "device");
    expect(timezonePickerValue(p)).toBe("device");
    expect(timezonePickerValue({ ...p, timezoneMode: "explicit" })).toBe(
      "Asia/Ho_Chi_Minh",
    );
  });
});
