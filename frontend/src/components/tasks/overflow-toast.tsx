import { Button } from "@/components/ui/button";
import { zonedDate } from "@/utils/tz";
import { useUserStore } from "@/hooks/use-user-store";
import type { SchedulingOverflow } from "@zenflow/shared";
import { format } from "date-fns";
import { CalendarClock, MoonStar } from "lucide-react";

/**
 * Toast body shown when the EDF engine can't place a created task before its
 * deadline. Offers up to two recovery actions; whichever are non-null on the
 * `overflow` payload. The proposed times are formatted in the user's tz via
 * {@link zonedDate} so they obey the calendar wall-clock rule.
 *
 * @param viewRange Optional human-readable label for the current view period
 *   (e.g. "the week of Jun 22–28" or "June 2026"). When provided, the heading
 *   and body copy reference the specific period rather than the generic
 *   granularity label from the overflow payload.
 */
export function OverflowToast({
  title,
  overflow,
  onChoose,
  onDismiss,
  viewRange,
}: {
  title: string;
  overflow: SchedulingOverflow;
  /** Fired with the chosen recovery option. */
  onChoose: (choice: "outsideHours" | "nextAvailable") => void;
  /** Keep the task unplaced. */
  onDismiss: () => void;
  /**
   * Human-readable label for the current view period, e.g.
   * "the week of Jun 22–28" or "June 2026". Supersedes the generic
   * granularity-based copy when present.
   */
  viewRange?: string;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const fmt = (iso: string) => format(zonedDate(iso, tz), "EEE MMM d, HH:mm");

  const { outsideHours, nextAvailable } = overflow;
  // The period it couldn't fit into mirrors the active calendar view; the
  // "next available" option carries that granularity. Fall back to a generic
  // phrasing when only the outside-hours option is available.
  const period = nextAvailable?.granularity;

  // Prefer the specific date-range label from the caller; fall back to the
  // generic granularity label from the backend payload ("this week", etc.).
  const periodLabel = viewRange ?? (period ? `this ${period}` : null);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">
          {periodLabel
            ? `No room left in ${periodLabel}`
            : "Couldn't schedule this task"}
        </p>
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t fit{" "}
          <span className="font-medium text-foreground">{title}</span> into your
          working hours{periodLabel ? ` in ${periodLabel}` : ""}. Pick a
          recovery option:
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {outsideHours && (
          <Button
            size="sm"
            className="w-full justify-start h-fit bg-primary py-2 text-primary-foreground hover:bg-primary/90"
            onClick={() => onChoose("outsideHours")}
          >
            <MoonStar className="size-4" />
            <span className="flex flex-col items-start leading-tight">
              <span>Schedule outside working hours</span>
              <span className="text-[11px] font-normal opacity-80">
                {fmt(outsideHours.scheduledStartTime)}
              </span>
            </span>
          </Button>
        )}

        {nextAvailable && (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start py-2 h-fit"
            onClick={() => onChoose("nextAvailable")}
          >
            <CalendarClock className="size-4" />
            <span className="flex flex-col items-start leading-tight">
              <span>Schedule next {nextAvailable.granularity}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {fmt(nextAvailable.scheduledStartTime)}
              </span>
            </span>
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-center text-muted-foreground"
          onClick={onDismiss}
        >
          Keep it unscheduled
        </Button>
      </div>
    </div>
  );
}
