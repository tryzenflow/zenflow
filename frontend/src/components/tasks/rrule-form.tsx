import { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ISO_TO_BYDAY, TaskFormValues } from "@/utils/tasks";
import type { ViewMode } from "@zenflow/shared";
import { cn } from "@/lib/utils";

interface RRuleFormProps {
  form: UseFormReturn<TaskFormValues>;
  /** Recurrence is scoped to the active view; "day" never renders this. */
  view: Exclude<ViewMode, "day">;
  /** Onboarding workdays (ISO 1–7) — constrains the selectable weekdays. */
  workDays: number[];
  /** A date inside the active window. Kept for API stability. */
  date?: Date;
}

const DAY_LABELS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

const segBase =
  "flex-1 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50";
const segActive = "bg-primary text-primary-foreground";
const segIdle = "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary";

const chipBase =
  "rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors";
const chipActive = "border-primary bg-primary/15 text-primary";
const chipIdle =
  "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary";

export function RRuleForm({ form, view, workDays }: RRuleFormProps) {
  const mode = form.watch("recurrenceMode");

  // Selectable weekdays, ordered Mon→Sun, limited to the user's workdays.
  const workdayCodes = useMemo(
    () =>
      [...workDays]
        .sort((a, b) => a - b)
        .map((iso) => ISO_TO_BYDAY[iso])
        .filter(Boolean),
    [workDays],
  );

  const toggleWeekday = (code: string) => {
    const current = form.getValues("byday");
    form.setValue(
      "byday",
      current.includes(code)
        ? current.filter((d) => d !== code)
        : [...current, code],
      { shouldDirty: true },
    );
  };

  const specificLabel = "Specific days";
  const boundHint =
    view === "week"
      ? "Repeats this week only — each occurrence is a single-instance task."
      : "Repeats on the selected weekdays within this month only.";

  return (
    <div className="space-y-3">
      {/* Mode: Every X days  vs  Specific days/weeks */}
      <FormField
        control={form.control}
        name="recurrenceMode"
        render={({ field }) => (
          <FormItem className="space-y-0">
            <div className="flex overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => field.onChange("interval")}
                className={cn(
                  segBase,
                  field.value === "interval" ? segActive : segIdle,
                )}
              >
                Every X days
              </button>
              <button
                type="button"
                onClick={() => field.onChange("specific")}
                className={cn(
                  segBase,
                  "border-l border-border",
                  field.value === "specific" ? segActive : segIdle,
                )}
              >
                {specificLabel}
              </button>
            </div>
          </FormItem>
        )}
      />

      {mode === "interval" && (
        <FormField
          control={form.control}
          name="interval"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold">Every</FormLabel>
              <div className="flex items-center gap-2">
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                    className="h-8 w-16 text-sm"
                  />
                </FormControl>
                <span className="text-sm text-muted-foreground">day(s)</span>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {mode === "specific" && (
        <FormField
          control={form.control}
          name="byday"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold">On days</FormLabel>
              <div className="flex flex-wrap gap-1.5">
                {workdayCodes.map((code) => {
                  const active = field.value.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleWeekday(code)}
                      className={cn(
                        chipBase,
                        "flex-1",
                        active ? chipActive : chipIdle,
                      )}
                    >
                      {DAY_LABELS[code]}
                    </button>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <p className="text-[11px] text-muted-foreground">{boundHint}</p>
    </div>
  );
}
