import { CHECKLIST_STEPS } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import {
  CHECKLIST_GROUPS,
  STEP_COPY,
  STEP_NEEDS,
  checklistProgress,
} from "../checklist";

describe("STEP_COPY", () => {
  it("has a title and hint for every step", () => {
    for (const id of CHECKLIST_STEPS) {
      expect(STEP_COPY[id].title).not.toBe("");
      expect(STEP_COPY[id].hint).not.toBe("");
    }
  });
});

describe("CHECKLIST_GROUPS", () => {
  it("puts every step in exactly one group, in step order", () => {
    expect(CHECKLIST_GROUPS.flatMap((g) => [...g.steps])).toEqual([
      ...CHECKLIST_STEPS,
    ]);
  });

  it("splits progress into Week and Month", () => {
    const { groups } = checklistProgress(["open-month"]);
    expect(groups.map((g) => g.title)).toEqual(["Week view", "Month view"]);
    expect(groups[0].items.some((i) => i.done)).toBe(false);
    expect(groups[1].items.filter((i) => i.done).map((i) => i.id)).toEqual([
      "open-month",
    ]);
  });
});

describe("STEP_NEEDS", () => {
  it("blocks task steps until a task is created", () => {
    const by = (seen: string[]) =>
      Object.fromEntries(
        checklistProgress(seen).items.map((i) => [i.id, i.blockedBy]),
      );
    expect(by([])["move-task"]).toBe("create-task");
    expect(by([])["block-actions"]).toBe("create-task");
    expect(by([])["move-day"]).toBe("create-task");
    expect(by([])["create-task"]).toBeNull();
    expect(by([])["open-day"]).toBeNull();
    expect(by(["create-task"])["move-task"]).toBeNull();
  });

  it("only ever depends on an earlier step", () => {
    for (const [step, needs] of Object.entries(STEP_NEEDS)) {
      expect(CHECKLIST_STEPS.indexOf(needs)).toBeLessThan(
        CHECKLIST_STEPS.indexOf(step as (typeof CHECKLIST_STEPS)[number]),
      );
    }
  });
});

describe("checklistProgress", () => {
  it("starts empty and visible", () => {
    const p = checklistProgress(undefined);
    expect(p.done).toBe(0);
    expect(p.total).toBe(CHECKLIST_STEPS.length);
    expect(p.visible).toBe(true);
    expect(p.items.map((i) => i.id)).toEqual([...CHECKLIST_STEPS]);
  });

  it("counts steps stored on the server or done this session", () => {
    const p = checklistProgress(["create-task"], new Set(["move-task"]));
    expect(p.done).toBe(2);
    expect(p.items.filter((i) => i.done).map((i) => i.id)).toEqual([
      "create-task",
      "move-task",
    ]);
  });

  it("ignores ids that aren't steps", () => {
    expect(checklistProgress(["checklist-hidden", "nope"]).done).toBe(0);
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
