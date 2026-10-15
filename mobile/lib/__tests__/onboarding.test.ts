import { zonedDate } from "@zenflow/core";
import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  addCustomTag,
  canGoBack,
  dndRoutinePayloads,
  filterTimezones,
  initialTagSelection,
  mergeTagNames,
  missingRoutines,
  newTagsForBulk,
  nextStep,
  pendingSetupItems,
  prevStep,
  routeForSession,
  tagOptions,
  tagsForBulk,
  toggleTag,
  utcOffsetMinutes,
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
    expect(nextStep("name")).toBe("focus");
    expect(nextStep("focus")).toBe("dlu");
    expect(nextStep("notifications")).toBe("done");
    expect(nextStep("done")).toBe("done");
  });
  it("walks back and clamps; no back on first/done", () => {
    expect(prevStep("dlu")).toBe("focus");
    expect(prevStep("focus")).toBe("name");
    expect(prevStep("name")).toBe("name");
    expect(canGoBack("name")).toBe(false);
    expect(canGoBack("focus")).toBe(true);
    expect(canGoBack("dlu")).toBe(true);
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
    // Sync-created tags (LMS/portal) don't count as resuming: defaults stay ticked.
    expect(initialTagSelection(["Thesis"])).toEqual([
      "Study",
      "Exam",
      "Assignment",
      "Project",
      "Thesis",
    ]);
    // Resuming with saved suggestions keeps exactly those.
    expect(initialTagSelection(["Lab", "Thesis"])).toEqual(["Lab", "Thesis"]);
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
  it("orders by proximity to the detected zone, not alphabetically", () => {
    const all = [
      "America/New_York",
      "Asia/Bangkok",
      "Asia/Tokyo",
      "Asia/Ho_Chi_Minh",
      "Australia/Perth",
      "Europe/Paris",
      "Asia/Jakarta",
    ];
    const out = filterTimezones(all, "", 50, "Asia/Ho_Chi_Minh");
    expect(out).not.toContain("Asia/Ho_Chi_Minh");
    // Same +7 offset first (same-region, then name), then nearer offsets.
    expect(out.slice(0, 2)).toEqual(["Asia/Bangkok", "Asia/Jakarta"]);
    expect(out.indexOf("Australia/Perth")).toBeLessThan(out.indexOf("Asia/Tokyo"));
    expect(out.indexOf("Asia/Tokyo")).toBeLessThan(out.indexOf("Europe/Paris"));
    expect(out.indexOf("Europe/Paris")).toBeLessThan(
      out.indexOf("America/New_York"),
    );
  });
  it("keeps the detected zone when searching", () => {
    expect(filterTimezones(["Asia/Ho_Chi_Minh", "Asia/Bangkok"], "asia", 50, "Asia/Ho_Chi_Minh")[0]).toBe("Asia/Bangkok");
  });
});

describe("newTagsForBulk / mergeTagNames", () => {
  const existing = Array.from({ length: 55 }, (_, i) => `e${i}`);
  it("sends only new tags, so >50 existing don't crowd out additions", () => {
    expect(newTagsForBulk([...existing, "Fresh", "E1"], existing)).toEqual([
      "Fresh",
    ]);
    expect(newTagsForBulk(existing, existing)).toEqual([]);
  });
  it("merges a response without dropping existing tags", () => {
    const merged = mergeTagNames(existing, ["Fresh", "e1"]);
    expect(merged).toHaveLength(56);
    expect(merged.slice(0, 55)).toEqual(existing);
  });
});

describe("utcOffsetMinutes", () => {
  const jan = new Date("2025-01-15T12:00:00Z");
  it("returns real offsets, not 0 for everything", () => {
    expect(utcOffsetMinutes("Asia/Ho_Chi_Minh", jan)).toBe(420);
    expect(utcOffsetMinutes("Asia/Kolkata", jan)).toBe(330);
    expect(utcOffsetMinutes("America/New_York", jan)).toBe(-300);
    expect(utcOffsetMinutes("UTC", jan)).toBe(0);
  });
});

describe("default routines", () => {
  const HCM = "Asia/Ho_Chi_Minh"; // UTC+7, no DST
  const at10 = new Date("2026-10-15T03:00:00Z"); // 10:00 in HCM
  const at21 = new Date("2026-10-15T14:00:00Z"); // 21:00 in HCM

  it("builds one daily DND per routine, durations on the 15-minute grid", () => {
    const payloads = dndRoutinePayloads(HCM, at10);
    expect(payloads.map((p) => [p.title, p.durationMinutes])).toEqual([
      ["Sleep", 420],
      ["Lunch break", 60],
      ["Dinner", 60],
    ]);
    for (const p of payloads) {
      expect(p.type).toBe("DND");
      expect(p.rrule).toBe("FREQ=DAILY");
      expect(p.durationMinutes % 15).toBe(0);
      expect(p).not.toHaveProperty("reminders");
    }
  });

  it("starts each routine today in the user's zone while still ahead", () => {
    const [sleep, lunch, dinner] = dndRoutinePayloads(HCM, at10);
    expect(sleep.scheduledStartTime).toBe("2026-10-15T16:00:00.000Z"); // 23:00 HCM
    expect(lunch.scheduledStartTime).toBe("2026-10-15T04:30:00.000Z"); // 11:30 HCM
    expect(dinner.scheduledStartTime).toBe("2026-10-15T10:00:00.000Z"); // 17:00 HCM
  });

  it("moves a routine whose start has passed to tomorrow", () => {
    const [sleep, lunch, dinner] = dndRoutinePayloads(HCM, at21);
    expect(sleep.scheduledStartTime).toBe("2026-10-15T16:00:00.000Z");
    expect(lunch.scheduledStartTime).toBe("2026-10-16T04:30:00.000Z");
    expect(dinner.scheduledStartTime).toBe("2026-10-16T10:00:00.000Z");
  });

  it("anchors the wall clock in the user's zone, not UTC", () => {
    // 08:00 in New York (EDT, UTC-4): 23:00 is 03:00 UTC the next day.
    const [sleep] = dndRoutinePayloads(
      "America/New_York",
      new Date("2026-10-15T12:00:00Z"),
    );
    expect(sleep.scheduledStartTime).toBe("2026-10-16T03:00:00.000Z");
  });

  it("runs the sleep block from 23:00 to 06:00 across midnight", () => {
    const [sleep] = dndRoutinePayloads(HCM, at10);
    const start = new Date(sleep.scheduledStartTime);
    const end = new Date(start.getTime() + sleep.durationMinutes * 60_000);
    const wall = (d: Date) =>
      format(zonedDate(d.toISOString(), HCM), "yyyy-MM-dd HH:mm");
    expect(wall(start)).toBe("2026-10-15 23:00");
    expect(wall(end)).toBe("2026-10-16 06:00");
  });

  it("skips routines already stored as DND series, ignoring case", () => {
    const payloads = dndRoutinePayloads(HCM, at10);
    const existing = [
      { type: "DND" as const, title: "sleep", rrule: "FREQ=DAILY" },
      { type: "TASK" as const, title: "Dinner", rrule: null },
    ];
    expect(missingRoutines(payloads, existing).map((p) => p.title)).toEqual([
      "Lunch break",
      "Dinner",
    ]);
  });
});
