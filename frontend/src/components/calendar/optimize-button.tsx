import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { isAxiosError } from "axios";
import {
  OPTIMIZE_LARGE_BATCH_THRESHOLD,
  OPTIMIZE_UI_MAX_WINDOW_DAYS,
  type OptimizeWindowInput,
} from "@zenflow/shared";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DateRangeSelect,
  type DateRangePreset,
} from "@/components/common/date-range-select";
import { OptimizeModeField } from "@/components/calendar/optimize-mode-field";
import { optimizeApply, optimizePreview } from "@/api/tasks";
import {
  ConfirmToastShell,
  maybeShowCascadeToast,
  shell,
} from "@/lib/scheduling-toasts";
import { errorToast } from "@/lib/toast";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedNow, zonedWallClockToUtc } from "@/utils/tz";

type OptimizeMode = OptimizeWindowInput["mode"];

/**
 * Header entry point for Optimize — the one explicit, opt-in, multi-task
 * scheduling action left in the redesigned scheduler (every other mutation —
 * Create/Edit/Drag/Resize/Delete/Complete — is now a narrow single-task
 * placement or a direct write that never touches other tasks). Opens a small
 * popover: a `DateRangeSelect` window (default the next 7 days, client-capped
 * at `OPTIMIZE_UI_MAX_WINDOW_DAYS`, distinct from and tighter than the
 * backend's own hard ceiling) and an `OptimizeModeField` radio-card list
 * defaulting to Mode 3 ("balanced"), with Mode 1 ("full reflow") / Mode 2
 * ("retain manual placements") shown inline alongside it — no disclosure.
 *
 * Confirming previews a COUNT ONLY — no per-task diff is ever rendered, per
 * the product decision that Optimize stays a one-click, undoable action
 * rather than a review-and-approve flow — and, only above
 * `OPTIMIZE_LARGE_BATCH_THRESHOLD`, shows a one-line confirm before actually
 * applying.
 */
export function OptimizeButton({ onOptimized }: { onOptimized: () => void }) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<OptimizeMode>("balanced");
  const [submitting, setSubmitting] = useState(false);
  const [windowStart, setWindowStart] = useState<Date>(() =>
    startOfDay(zonedNow(tz)),
  );
  const [windowEnd, setWindowEnd] = useState<Date>(() =>
    addDays(startOfDay(zonedNow(tz)), 7),
  );

  function resetWindow() {
    const start = startOfDay(zonedNow(tz));
    setWindowStart(start);
    setWindowEnd(addDays(start, 7));
    setMode("balanced");
  }

  // Optimize only ever looks forward, so the picker offers future-oriented
  // presets (never "Last Month"/"Last Year" etc.) and disables past dates
  // outright rather than only rejecting them on submit.
  const today = useMemo(() => startOfDay(zonedNow(tz)), [tz]);
  const presets: DateRangePreset[] = useMemo(
    () => [
      { label: "Today", start: today, end: today },
      { label: "Next 7 days", start: today, end: addDays(today, 7) },
      { label: "Next 30 days", start: today, end: addDays(today, 30) },
      {
        label: `Next ${OPTIMIZE_UI_MAX_WINDOW_DAYS} days`,
        start: today,
        end: addDays(today, OPTIMIZE_UI_MAX_WINDOW_DAYS),
      },
    ],
    [today],
  );

  async function runApply(input: OptimizeWindowInput) {
    try {
      const response = await optimizeApply(input);
      onOptimized();
      if (response.count) {
        maybeShowCascadeToast(response, tz, onOptimized);
      } else {
        toast.success("Nothing to optimize — already in good shape.");
      }
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Couldn't optimize the schedule",
      );
    }
  }

  async function handleOptimize() {
    if (windowEnd <= windowStart) {
      errorToast("End date must be after the start date");
      return;
    }
    if (
      differenceInCalendarDays(windowEnd, windowStart) >
      OPTIMIZE_UI_MAX_WINDOW_DAYS
    ) {
      errorToast(
        `Pick a range of ${OPTIMIZE_UI_MAX_WINDOW_DAYS} days or fewer`,
      );
      return;
    }

    const input: OptimizeWindowInput = {
      windowStart: zonedWallClockToUtc(windowStart, tz).toISOString(),
      windowEnd: zonedWallClockToUtc(windowEnd, tz).toISOString(),
      mode,
    };

    setSubmitting(true);
    try {
      const preview = await optimizePreview(input);
      setOpen(false);

      if (!preview.count) {
        toast.success("Nothing to optimize — already in good shape.");
        return;
      }

      if (preview.count > OPTIMIZE_LARGE_BATCH_THRESHOLD) {
        // One-line count-only guard — never a per-task diff.
        toast.custom(
          (toastId) =>
            shell(
              <ConfirmToastShell
                title="Large batch"
                description={`Reschedule ~${preview.count} tasks in this range?`}
                actions={[
                  {
                    label: "Reschedule",
                    onClick: () => {
                      toast.dismiss(toastId);
                      void runApply(input);
                    },
                  },
                  {
                    label: "Cancel",
                    variant: "outline",
                    onClick: () => toast.dismiss(toastId),
                  },
                ]}
              />,
            ),
          { duration: Infinity },
        );
        return;
      }

      await runApply(input);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Couldn't preview the optimize run",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetWindow();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Optimize schedule"
          title="Optimize schedule"
        >
          <Sparkles className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground">
            Optimize schedule
          </p>
          <p className="text-xs text-muted-foreground">
            Repacks pending tasks in a date range — nothing outside it moves.
          </p>
        </div>

        <DateRangeSelect
          from={windowStart}
          to={windowEnd}
          onFromChange={(d) => d && setWindowStart(startOfDay(d))}
          onToChange={(d) => d && setWindowEnd(startOfDay(d))}
          placeholder="Select a date range"
          presets={presets}
          disabledBefore={today}
          maxRangeDays={OPTIMIZE_UI_MAX_WINDOW_DAYS}
        />

        <OptimizeModeField value={mode} onChange={setMode} />

        <Button
          size="sm"
          className="w-full"
          disabled={submitting}
          onClick={handleOptimize}
        >
          {submitting ? "Previewing…" : "Optimize"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
