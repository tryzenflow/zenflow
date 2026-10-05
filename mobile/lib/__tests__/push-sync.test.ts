import { describe, expect, it } from "vitest";
import { decideLaunchSync, deriveNotificationsActive } from "../push-sync";

describe("deriveNotificationsActive", () => {
  it("requires permission and registration", () => {
    expect(deriveNotificationsActive(true, true)).toBe(true);
    expect(deriveNotificationsActive(true, false)).toBe(false);
    expect(deriveNotificationsActive(false, true)).toBe(false);
    expect(deriveNotificationsActive(null, true)).toBe(false);
    expect(deriveNotificationsActive(true, null)).toBe(false);
  });
});

describe("decideLaunchSync", () => {
  const base = {
    permissionGranted: true,
    token: "t2",
    registered: false,
    markerToken: null as string | null,
  };

  it("does nothing without permission or token", () => {
    expect(decideLaunchSync({ ...base, permissionGranted: false })).toBe("none");
    expect(decideLaunchSync({ ...base, token: null })).toBe("none");
  });

  it("never registers a device that was never decided / turned off", () => {
    expect(decideLaunchSync(base)).toBe("none");
  });

  it("does not re-enable when the row was removed but the token is unchanged", () => {
    expect(decideLaunchSync({ ...base, token: "t1", markerToken: "t1" })).toBe(
      "none",
    );
  });

  it("rotates when the server lacks a new token this install registered before", () => {
    expect(decideLaunchSync({ ...base, markerToken: "t1" })).toBe("rotate");
  });

  it("marks an already-registered device without a marker", () => {
    expect(decideLaunchSync({ ...base, registered: true })).toBe("mark");
    expect(
      decideLaunchSync({ ...base, registered: true, markerToken: "t2" }),
    ).toBe("none");
  });
});
