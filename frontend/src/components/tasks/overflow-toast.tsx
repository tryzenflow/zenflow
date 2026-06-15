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
 */
export function OverflowToast({
  title,
  overflow,
  onChoose,
  onDismiss,
}: {
  title: string;
  overflow: SchedulingOverflow;
  /** Fired with the chosen recovery option. */
  onChoose: (choice: "outsideHours" | "nextAvailable") => void;
  /** Keep the task unplaced. */
  onDismiss: () => void;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const fmt = (iso: string) => format(zonedDate(iso, tz), "EEE MMM d, HH:mm");

  const { outsideHours, nextAvailable } = overflow;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">
          No slot before the deadline
        </p>
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t fit{" "}
          <span className="font-medium text-foreground">{title}</span> into your
          working hours. Pick a recovery option:
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {outsideHours && (
          <Button
            size="sm"
            className="w-full justify-start bg-primary text-primary-foreground hover:bg-primary/90"
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
            className="w-full justify-start"
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
