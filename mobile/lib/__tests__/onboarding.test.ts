import { describe, expect, it } from "vitest";
import {
  addCustomTag,
  canGoBack,
  filterTimezones,
  initialTagSelection,
  nextStep,
  pendingSetupItems,
  prevStep,
  routeForSession,
  tagOptions,
  tagsForBulk,
  toggleTag,
} from "../onboarding";

describe("routeForSession", () => {
  it("sends signed-out users to login", () => {
    expect(routeForSession(null, "(app)")).toBe("/(auth)/login");
    expect(routeForSession(null, "(auth)")).toBeNull();
  });
  it("routes un-onboarded users to onboarding", () => {
    const u = { onboardedAt: null };
    expect(routeForSession(u, "(auth)")).toBe("/(onboarding)");
    expect(routeForSession(u, "(app)")).toBe("/(onboarding)");
    expect(routeForSession(u, "(onboarding)")).toBeNull();
  });
  it("leaves existing users alone and bounces them out of onboarding/auth", () => {
    const u = { onboardedAt: "2026-01-01T00:00:00.000Z" };
    expect(routeForSession(u, "(app)")).toBeNull();
    expect(routeForSession(u, "(auth)")).toBe("/(app)");
    expect(routeForSession(u, "(onboarding)")).toBe("/(app)");
  });
});

describe("step navigation", () => {
  it("walks forward and clamps", () => {
    expect(nextStep("language")).toBe("name");
    expect(nextStep("tags")).toBe("done");
    expect(nextStep("done")).toBe("done");
  });
  it("walks back and clamps; no back on first/done", () => {
    expect(prevStep("name")).toBe("language");
    expect(prevStep("language")).toBe("language");
    expect(canGoBack("language")).toBe(false);
    expect(canGoBack("name")).toBe(true);
    expect(canGoBack("done")).toBe(false);
  });
});

describe("tags", () => {
  it("pre-ticks the first four, or resumes existing", () => {
    expect(initialTagSelection([])).toEqual([
      "Study",
      "Exam",
      "Assignment",
      "Project",
    ]);
    expect(initialTagSelection(["Thesis"])).toEqual(["Thesis"]);
  });
  it("toggles case-insensitively", () => {
    expect(toggleTag(["Study"], "study")).toEqual([]);
    expect(toggleTag([], "Lab")).toEqual(["Lab"]);
  });
  it("adds custom tags, normalizing and de-duping", () => {
    expect(addCustomTag(["Study"], "  Thesis  draft ")).toEqual([
      "Study",
      "Thesis draft",
    ]);
    expect(addCustomTag(["Study"], "study")).toEqual(["Study"]);
    expect(addCustomTag([], "lab")).toEqual(["Lab"]);
    expect(addCustomTag(["Study"], "   ")).toEqual(["Study"]);
    expect(addCustomTag([], "x".repeat(51))).toEqual([]);
  });
  it("lists custom tags after suggestions", () => {
    expect(tagOptions(["Study", "Thesis"]).slice(-1)).toEqual(["Thesis"]);
  });
  it("builds a bulk payload", () => {
    expect(tagsForBulk(["A", "a", " B "])).toEqual(["A", "B"]);
    expect(tagsForBulk([])).toEqual([]);
    expect(
      tagsForBulk(Array.from({ length: 60 }, (_, i) => `t${i}`)),
    ).toHaveLength(50);
  });
});

describe("pendingSetupItems", () => {
  it("derives from real state", () => {
    expect(
      pendingSetupItems({ notificationsActive: true, dluConnected: true }),
    ).toEqual([]);
    expect(
      pendingSetupItems({ notificationsActive: false, dluConnected: false }),
    ).toEqual(["notifications", "dlu"]);
  });
});

describe("filterTimezones", () => {
  const zones = ["Asia/Singapore", "Asia/Ho_Chi_Minh", "Europe/Paris"];
  it("filters", () => {
    expect(filterTimezones(zones, "sing")).toEqual(["Asia/Singapore"]);
    expect(filterTimezones(zones, "ho chi")).toEqual(["Asia/Ho_Chi_Minh"]);
    expect(filterTimezones(zones, "")).toEqual(zones);
  });
});
