import { useEffect } from "react";
import {
  MAX_TASK_SESSION_COUNT,
  daysUntilDeadline,
  maxFeasibleSessionCount,
  sessionCadenceLabel,
} from "@zenflow/core";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * `1..max` slider for a multi-sitting `TASK` series' `sessionCount`. `max` is
 * bounded by what still fits before the deadline and by one sitting per day
 * (`maxFeasibleSessionCount` / `daysUntilDeadline`), so the UI can't produce a
 * value that trips `sessionSchema`'s feasibility check. Mirrors
 * `mobile/components/tasks/form/session-count-field.tsx` (behaviour, not gesture
 * code).
 */
export function SessionCountField({
  value,
  onChange,
  deadline,
  duration,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  deadline: string | undefined;
  duration: number | undefined;
  disabled?: boolean;
}) {
  const feasible = maxFeasibleSessionCount(deadline, duration);
  const days = daysUntilDeadline(deadline);
  const ceiling = feasible > 0 ? feasible : MAX_TASK_SESSION_COUNT;
  const max = Math.max(1, Math.min(ceiling, days));

  useEffect(() => {
    if (value > max) onChange(max);
  }, [max, value, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold tabular-nums">
          {value} {value === 1 ? "session" : "sessions"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {sessionCadenceLabel(value, days)}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={disabled || value <= 1}
          onClick={() => onChange(1)}
          className={cn(
            "text-xs font-medium tabular-nums text-muted-foreground disabled:opacity-40",
          )}
        >
          1
        </button>
        <Slider
          className="flex-1"
          min={1}
          max={max}
          step={1}
          value={[Math.min(value, max)]}
          disabled={disabled || max <= 1}
          onValueChange={([v]) => onChange(v)}
        />
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => onChange(max)}
          className="text-xs font-medium tabular-nums text-muted-foreground disabled:opacity-40"
        >
          {max}
        </button>
      </div>
    </div>
  );
}
