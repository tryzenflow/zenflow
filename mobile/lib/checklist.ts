import { CHECKLIST_STEPS, type ChecklistStep, type TipId } from "@zenflow/shared";

/**
 * The "Getting started" checklist (issue #116). RN-free so it can be unit-tested
 * (`lib/__tests__/checklist.test.ts`). Each step is ticked off by the real
 * action (see `hooks/use-checklist.ts` call sites); the strings match the
 * labels in `block-actions-sheet.tsx` / `reschedule-sheet.tsx`.
 */

export const STEP_COPY: Record<ChecklistStep, { title: string; hint: string }> =
  {
    "switch-day": {
      title: "Switch day",
      hint: "Swipe the calendar, or tap a day at the top.",
    },
    "create-task": {
      title: "Create a task",
      hint: "Tap +, or long-press an empty slot.",
    },
    "move-task": {
      title: "Move a task",
      hint: "Hold and drag it to reschedule in 15-minute steps. Tap to edit.",
    },
    "block-actions": {
      title: "Hold a task for more actions",
      hint: "Hold it without moving. Move to… changes the day.",
    },
    "open-month": {
      title: "Open the Month view",
      hint: "Tap Month in the tab bar.",
    },
    "open-day": {
      title: "Open a day",
      hint: "Tap a day in the month to see its tasks.",
    },
    "move-day": {
      title: "Move a task to another day",
      hint: "Hold a task and drag it onto another day, or tap the calendar button.",
    },
  };

/**
 * The screen a step's "show me" spotlight lives on (`null`: either — the + button
 * and the tab bar are on both). Tapping a row switches to it first.
 */
export const STEP_SCREEN: Record<ChecklistStep, "week" | "month" | null> = {
  "switch-day": "week",
  "create-task": null,
  "move-task": "week",
  "block-actions": "week",
  "open-month": null,
  "open-day": "month",
  "move-day": "month",
};

/**
 * A step that can't be tried until another is done: moving or holding a task
 * needs a task to exist. Tapping it before then spotlights the earlier step
 * ("create a task first") instead.
 */
export const STEP_NEEDS: Partial<Record<ChecklistStep, ChecklistStep>> = {
  "move-task": "create-task",
  "block-actions": "create-task",
  "move-day": "create-task",
};

/** The checklist is shown in two groups, matching the two calendar screens. */
export const CHECKLIST_GROUPS: {
  id: "week" | "month";
  title: string;
  steps: readonly ChecklistStep[];
}[] = [
  {
    id: "week",
    title: "Week view",
    steps: ["switch-day", "create-task", "move-task", "block-actions"],
  },
  {
    id: "month",
    title: "Month view",
    steps: ["open-month", "open-day", "move-day"],
  },
];

export interface ChecklistItem {
  id: ChecklistStep;
  title: string;
  hint: string;
  done: boolean;
  /** The step to do first (not done yet), if this one needs it. */
  blockedBy: ChecklistStep | null;
}

export interface ChecklistGroup {
  id: "week" | "month";
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistProgress {
  items: ChecklistItem[];
  /** `items` split into the Week / Month groups, in display order. */
  groups: ChecklistGroup[];
  done: number;
  total: number;
  /** Every step done. */
  complete: boolean;
  /** Show the "Getting started" pill: not hidden by the user and not finished. */
  visible: boolean;
}

/** Progress from the server's `seenTips` plus anything done this session. */
export function checklistProgress(
  seenTips: readonly string[] | undefined,
  doneThisSession: ReadonlySet<TipId> = new Set(),
): ChecklistProgress {
  const isDone = (id: TipId) =>
    (seenTips ?? []).includes(id) || doneThisSession.has(id);
  const items = CHECKLIST_STEPS.map((id) => {
    const needs = STEP_NEEDS[id];
    return {
      id,
      ...STEP_COPY[id],
      done: isDone(id),
      blockedBy: needs && !isDone(needs) ? needs : null,
    };
  });
  const done = items.filter((i) => i.done).length;
  const complete = done === items.length;
  const groups = CHECKLIST_GROUPS.map(({ id, title, steps }) => ({
    id,
    title,
    items: items.filter((i) => steps.includes(i.id)),
  }));
  return {
    items,
    groups,
    done,
    total: items.length,
    complete,
    visible: !isDone("checklist-hidden") && !complete,
  };
}
