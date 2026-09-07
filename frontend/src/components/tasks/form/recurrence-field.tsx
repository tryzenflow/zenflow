import { useMemo } from "react";
import { format } from "date-fns";
import {
  type RecurrenceFreq,
  type RecurrenceState,
  fromRrule,
  toRrule,
} from "@zenflow/core";
import { DatePicker } from "@/components/ui/datepicker";
import { cn } from "@/lib/utils";

const WEEKDAYS: { key: string; label: string }[] = [
  { key: "MO", label: "M" },
  { key: "TU", label: "T" },
  { key: "WE", label: "W" },
  { key: "TH", label: "T" },
  { key: "FR", label: "F" },
  { key: "SA", label: "S" },
  { key: "SU", label: "S" },
];

const FREQS: { value: RecurrenceFreq; label: string }[] = [
  { value: "NONE", label: "Once" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
];

/**
 * Recurrence builder for the fixed session types (DND / assignment / exam /
 * lecture) — a constrained subset of RFC 5545: None / Daily / Weekly, an
 * optional weekday set (Weekly only), and an optional end date. Emits the
 * form's `rrule` string (or `undefined` for a one-off). Mirrors
 * `mobile/components/tasks/form/recurrence-field.tsx`; the string ⇄ state
 * conversion is shared via `@zenflow/core`.
 */
export function RecurrenceField({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (rrule: string | undefined) => void;
  disabled?: boolean;
}) {
  const state = useMemo(() => fromRrule(value), [value]);
  const set = (next: Partial<RecurrenceState>) =>
    onChange(toRrule({ ...state, ...next }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {FREQS.map((f) => {
          const active = state.freq === f.value;
          return (
            <button
              key={f.value}
              type="button"
              disabled={disabled}
              onClick={() => set({ freq: f.value })}
              className={cn(
                "h-8 rounded-md border text-xs font-semibold transition-colors disabled:opacity-50",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {state.freq === "WEEKLY" && (
        <div className="flex justify-between gap-1">
          {WEEKDAYS.map((d, i) => {
            const active = state.byday.includes(d.key);
            return (
              <button
                key={`${d.key}-${i}`}
                type="button"
                disabled={disabled}
                onClick={() =>
                  set({
                    byday: active
                      ? state.byday.filter((x) => x !== d.key)
                      : [...state.byday, d.key],
                  })
                }
                className={cn(
                  "size-8 rounded-full border text-xs font-semibold transition-colors disabled:opacity-50",
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
                )}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      )}

      {state.freq !== "NONE" && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">
            Ends on (optional)
          </p>
          <div className="flex items-center gap-2">
            <DatePicker
              className="flex-1"
              placeholder="No end date"
              date={state.until ? new Date(`${state.until}T00:00:00`) : undefined}
              disabled={disabled || { before: new Date() }}
              onSelect={(d) =>
                set({ until: d ? format(d, "yyyy-MM-dd") : undefined })
              }
            />
            {state.until && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => set({ until: undefined })}
                className="h-9 rounded-md border border-border bg-muted px-3 text-xs font-medium text-muted-foreground hover:bg-muted/70 disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {state.until
              ? "Repeats until this date."
              : "Repeats indefinitely."}
          </p>
        </div>
      )}
    </div>
  );
}
