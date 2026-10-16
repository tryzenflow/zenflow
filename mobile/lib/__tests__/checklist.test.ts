import { CHECKLIST_STEPS } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { STEP_COPY, STEP_SCREEN, checklistProgress } from "../checklist";

describe("CHECKLIST_STEPS", () => {
  it("is the three steps: connect DLU, add a task, finish a session", () => {
    expect([...CHECKLIST_STEPS]).toEqual([
      "connect-dlu",
      "add-task",
      "finish-session",
    ]);
  });
});

describe("STEP_COPY", () => {
  it("has a title and hint for every step", () => {
    for (const id of CHECKLIST_STEPS) {
      expect(STEP_COPY[id].title).not.toBe("");
      expect(STEP_COPY[id].hint).not.toBe("");
    }
  });
});

describe("STEP_SCREEN", () => {
  it("opens DLU on the Me tab and the other steps on the calendar", () => {
    expect(STEP_SCREEN["connect-dlu"]).toBe("me");
    expect(STEP_SCREEN["add-task"]).toBe("calendar");
    expect(STEP_SCREEN["finish-session"]).toBe("calendar");
  });
});

describe("checklistProgress", () => {
  it("starts empty and visible with three items", () => {
    const p = checklistProgress(undefined);
    expect(p.done).toBe(0);
    expect(p.total).toBe(3);
    expect(p.visible).toBe(true);
    expect(p.items.map((i) => i.id)).toEqual([...CHECKLIST_STEPS]);
  });

  it("counts steps stored on the server or done this session", () => {
    const p = checklistProgress(["connect-dlu"], new Set(["finish-session"]));
    expect(p.done).toBe(2);
    expect(p.items.filter((i) => i.done).map((i) => i.id)).toEqual([
      "connect-dlu",
      "finish-session",
    ]);
  });

  it("counts a task created before the trim as the add-task step", () => {
    const p = checklistProgress(["create-task"]);
    expect(p.items.find((i) => i.id === "add-task")?.done).toBe(true);
  });

  it("ignores retired step ids that are not steps any more", () => {
    expect(checklistProgress(["open-month", "move-day"]).done).toBe(0);
  });

  it("is hidden once the user hides it, even this session", () => {
    expect(checklistProgress(["checklist-hidden"]).visible).toBe(false);
    expect(checklistProgress([], new Set(["checklist-hidden"])).visible).toBe(
      false,
    );
  });

  it("is hidden and complete once every step is done", () => {
    const p = checklistProgress([...CHECKLIST_STEPS]);
    expect(p.complete).toBe(true);
    expect(p.visible).toBe(false);
  });
});
