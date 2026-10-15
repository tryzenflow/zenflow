import type { PlacementReason } from "@zenflow/shared";
import { zonedDate } from "@zenflow/core";
import { format, t } from "./i18n";

/** Copy keys (EN source; VI in `i18n-vi.ts`) for each placement reason. `{time}` is the start. */
export const PLACEMENT_REASON_KEYS: Record<PlacementReason, string> = {
  PREFERRED_HOUR: "Placed at {time}, you usually study then",
  BEFORE_DEADLINE: "Placed at {time}, before the deadline",
  ONLY_FREE_SLOT: "Placed at {time}, the only free slot",
  NEAR_CLASS: "Placed at {time}, next to another session",
  MOVED_FOR_DEADLINE: "Placed at {time}, other sessions moved to fit it",
  BEST_AVAILABLE: "Placed at {time}, the best time left",
};

/**
 * The one-line reason for a scheduled session's start, in the active language,
 * or null when there is no reason to show.
 */
export function placementReasonLine(
  reason: PlacementReason | null | undefined,
  scheduledStartTime: string,
  tz: string,
): string | null {
  if (!reason) return null;
  const time = format(zonedDate(scheduledStartTime, tz), "HH:mm");
  return t(PLACEMENT_REASON_KEYS[reason], { time });
}
