import { CHECKLIST_STEPS, type ChecklistStep, type TipId } from "@zenflow/shared";
import { t } from "./i18n";

/**
 * The "Getting started" checklist (issue #116, trimmed to 3 steps in #245).
 * RN-free so it can be unit-tested (`lib/__tests__/checklist.test.ts`). Each
 * step is ticked off by the real action (see `hooks/use-checklist.ts` call
 * sites). Ids live in `CHECKLIST_STEPS` in `@zenflow/shared`.
 */

/** Title/hint read through `t()` on access, so a language switch shows up without rebuilding the table. */
function copy(title: string, hint: string) {
  return {
    get title() {
      return t(title);
    },
    get hint() {
      return t(hint);
    },
  };
}

export const STEP_COPY: Record<ChecklistStep, { title: string; hint: string }> =
  {
    "connect-dlu": copy("Connect DLU", "Import your timetable from the portal."),
    "add-task": copy("Add a task", "Tap + to schedule your first session."),
    "finish-session": copy(
      "Finish a session",
      "Mark a session done when you complete it.",
    ),
  };

/** Retired ids that count as a step done: a task created before the trim. */
const ALIASES: Partial<Record<ChecklistStep, TipId>> = {
  "add-task": "create-task",
};

/** Where a step's row opens: the Me tab for DLU, the calendar otherwise. */
export const STEP_SCREEN: Record<ChecklistStep, "calendar" | "me"> = {
  "connect-dlu": "me",
  "add-task": "calendar",
  "finish-session": "calendar",
};

export interface ChecklistItem {
  id: ChecklistStep;
  title: string;
  hint: string;
  done: boolean;
}

export interface ChecklistProgress {
  items: ChecklistItem[];
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
    const alias = ALIASES[id];
    return {
      id,
      ...STEP_COPY[id],
      done: isDone(id) || (alias !== undefined && isDone(alias)),
    };
  });
  const done = items.filter((i) => i.done).length;
  const complete = done === items.length;
  return {
    items,
    done,
    total: items.length,
    complete,
    visible: !isDone("checklist-hidden") && !complete,
  };
}
