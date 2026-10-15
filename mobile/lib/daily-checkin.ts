import { markSession } from "@/api/check-off";
import type { CheckInAction } from "@/lib/daily-push";

/**
 * Apply one evening check-in action to each session. Runs from the background
 * task (Android) or the foreground response listener (iOS). A failed session is
 * counted, not retried; the next check-in or the app shows the true state.
 */
export async function applyCheckIn(
  action: CheckInAction,
  sessionIds: string[],
): Promise<{ applied: number; failed: number }> {
  const kind = action === "done" ? "complete" : "skip";
  const results = await Promise.allSettled(
    sessionIds.map((id) => markSession(id, kind)),
  );
  const applied = results.filter((r) => r.status === "fulfilled").length;
  return { applied, failed: results.length - applied };
}
