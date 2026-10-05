import { describe, expect, it } from "vitest";
import { decidePushAction, deriveNotificationsActive } from "../push-sync";

describe("deriveNotificationsActive", () => {
  it("requires the server preference and OS permission", () => {
    expect(deriveNotificationsActive(true, "granted")).toBe(true);
    expect(deriveNotificationsActive(false, "granted")).toBe(false);
    expect(deriveNotificationsActive(true, "denied")).toBe(false);
    expect(deriveNotificationsActive(true, "blocked")).toBe(false);
    expect(deriveNotificationsActive(true, null)).toBe(false);
    expect(deriveNotificationsActive(undefined, "granted")).toBe(false);
  });
});

describe("decidePushAction", () => {
  const base = {
    allowNotifications: true,
    permission: "undetermined" as const,
    onboarded: true,
    alreadyPrompted: false,
  };

  it("never acts during onboarding", () => {
    for (const permission of ["granted", "undetermined", "blocked"] as const) {
      expect(decidePushAction({ ...base, permission, onboarded: false })).toBe(
        "none",
      );
    }
  });

  it("never registers or prompts when the user opted out", () => {
    expect(
      decidePushAction({ ...base, allowNotifications: false, permission: "granted" }),
    ).toBe("none");
    expect(decidePushAction({ ...base, allowNotifications: false })).toBe("none");
  });

  it("does nothing until permission is read", () => {
    expect(decidePushAction({ ...base, permission: null })).toBe("none");
  });

  it("registers silently when permission is already granted", () => {
    expect(decidePushAction({ ...base, permission: "granted" })).toBe("register");
    expect(
      decidePushAction({ ...base, permission: "granted", alreadyPrompted: true }),
    ).toBe("register");
  });

  it("prompts once for an askable permission", () => {
    expect(decidePushAction(base)).toBe("prompt");
    expect(decidePushAction({ ...base, permission: "denied" })).toBe("prompt");
  });

  it("does not re-prompt in the same login; treats it as denied", () => {
    expect(decidePushAction({ ...base, alreadyPrompted: true })).toBe("disable");
  });

  it("disables when permission is permanently denied", () => {
    expect(decidePushAction({ ...base, permission: "blocked" })).toBe("disable");
  });
});
