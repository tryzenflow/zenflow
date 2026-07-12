import { isAxiosError } from "axios";
import { errorToast } from "@/lib/toast";
import { hasManualTaskInWindow } from "@/utils/tasks";
import { rescheduleCascade } from "@/api/tasks";
import type { Event as CalendarBlock } from "@/types/schedule";
import { showDisplacedSummaryToast } from "./displaced-summary-toast";
import { showRescheduleConfirmToast } from "./reschedule-confirm-toast";
import { showRescheduleChoiceToast } from "./reschedule-choice-toast";

/**
 * The single confirm-before-reschedule entry point (todo.md §Rescheduling
 * Design) shared by every trigger that can leave a schedule gap/conflict
 * behind — a deadline edit, a tags-driven duration change, a delete's
 * gap-fill, and a create that couldn't find room without displacing
 * anything. Shows the 3-option manual-vs-auto choice when a manually-moved
 * task sits in `window`, otherwise the plain 2-button confirm; either way,
 * confirming calls `POST /tasks/reschedule-cascade` for `window` and
 * surfaces the displaced summary. Callers own their own window computation
 * and gating (whether to call this at all) — different triggers anchor the
 * window differently and skip it under different conditions.
 */
export function promptRescheduleCascade({
  window,
  title,
  description,
  manualDescription,
  blocks,
  tz,
  titleFor,
  onDone,
  onDecline,
}: {
  window: { windowStart: string; windowEnd: string };
  title: string;
  description: React.ReactNode;
  manualDescription: React.ReactNode;
  blocks: CalendarBlock[];
  tz: string;
  titleFor: (id: string) => string | undefined;
  onDone: () => void;
  /** Fired when the user declines — e.g. create falls back to overflow-recovery. */
  onDecline?: () => void;
}) {
  async function runCascade(extra?: { includeManual?: boolean }) {
    try {
      const cascade = await rescheduleCascade({ ...window, ...extra });
      showDisplacedSummaryToast(cascade.displaced, tz, titleFor);
      onDone();
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Couldn't reschedule affected tasks",
      );
    }
  }

  if (hasManualTaskInWindow(blocks, window.windowStart, window.windowEnd)) {
    showRescheduleChoiceToast({
      title,
      description: manualDescription,
      onOnlyAuto: () => runCascade(),
      onEveryone: () => runCascade({ includeManual: true }),
      onDecline,
    });
  } else {
    showRescheduleConfirmToast({
      title,
      description,
      onConfirm: () => runCascade(),
      onDecline,
    });
  }
}
