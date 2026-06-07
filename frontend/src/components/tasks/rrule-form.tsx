import { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import {
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { AlertTriangle } from "lucide-react";
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { TaskFormValues } from "@/utils/tasks";
import type { ViewMode } from "@zenflow/shared";
import { cn } from "@/lib/utils";

interface RRuleFormProps {
  form: UseFormReturn<TaskFormValues>;
  /** Recurrence is scoped to the active view; "day" never renders this. */
  view: Exclude<ViewMode, "day">;
  /** Onboarding workdays (ISO 1–7) — used to gray (not disable) non-workdays. */
  workDays: number[];
  /** A date inside the active month (for the week-of-month ranges). */
  date: Date;
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

/** Mon→Sun order, the natural week-start used everywhere in the calendar. */
const WEEKDAY_ORDER: { code: string; iso: number }[] = [
  { code: "MO", iso: 1 },
  { code: "TU", iso: 2 },
  { code: "WE", iso: 3 },
  { code: "TH", iso: 4 },
  { code: "FR", iso: 5 },
  { code: "SA", iso: 6 },
  { code: "SU", iso: 7 },
];

const chipBase =
  "rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors";
const chipActive = "border-primary bg-primary/15 text-primary";
const chipIdle =
  "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary";
// Non-workday, idle: visually muted but clearly still interactive.
const chipOffIdle =
  "border-dashed border-border/60 bg-transparent text-muted-foreground/60 hover:bg-primary/10 hover:text-primary";

export function RRuleForm({ form, view, workDays, date }: RRuleFormProps) {
  const workDaySet = useMemo(() => new Set(workDays), [workDays]);

  // Week-of-month ranges for the active month (Mon-started weeks overlapping it).
  const weeks = useMemo(() => {
    const monthEnd = endOfMonth(date);
    const out: { n: number; label: string }[] = [];
    let cursor = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
    let n = 1;
    while (cursor <= monthEnd) {
      const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
      out.push({ n, label: `${format(cursor, "d/M")}–${format(weekEnd, "d/M")}` });
      cursor = addWeeks(cursor, 1);
      n++;
    }
    return out;
  }, [date]);

  const byday = form.watch("byday");
  const byweeks = form.watch("byweeks");

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

  const setAllWeekdays = (on: boolean) => {
    form.setValue("byday", on ? WEEKDAY_ORDER.map((d) => d.code) : [], {
      shouldDirty: true,
    });
  };

  const toggleWeek = (n: number) => {
    const current = form.getValues("byweeks");
    form.setValue(
      "byweeks",
      current.includes(n) ? current.filter((w) => w !== n) : [...current, n],
      { shouldDirty: true },
    );
  };

  const setAllWeeks = (on: boolean) => {
    form.setValue("byweeks", on ? weeks.map((w) => w.n) : [], {
      shouldDirty: true,
    });
  };

  const allWeekdaysSelected = byday.length === WEEKDAY_ORDER.length;
  const allWeeksSelected =
    weeks.length > 0 && byweeks.length === weeks.length;

  // Selected weekdays that fall outside the user's working days.
  const nonWorkdaySelected = WEEKDAY_ORDER.filter(
    (d) => byday.includes(d.code) && !workDaySet.has(d.iso),
  );

  const boundHint =
    view === "week"
      ? "Repeats this week only — each occurrence is a single-instance task."
      : "Repeats within this month only — one occurrence per selected week × day.";

  // Reusable Mon→Sun weekday chip grid (shared by week & month views).
  const weekdayChips = (
    <FormField
      control={form.control}
      name="byday"
      render={({ field }) => (
        <FormItem className="space-y-1.5">
          <div className="flex items-center justify-between">
            <FormLabel className="text-xs font-semibold">On days</FormLabel>
            <SelectAll
              id="rrule-all-weekdays"
              checked={allWeekdaysSelected}
              onCheckedChange={setAllWeekdays}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_ORDER.map(({ code, iso }) => {
              const active = field.value.includes(code);
              const isWorkday = workDaySet.has(iso);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleWeekday(code)}
                  className={cn(
                    chipBase,
                    "flex-1",
                    active ? chipActive : isWorkday ? chipIdle : chipOffIdle,
                  )}
                >
                  {DAY_LABELS[code]}
                </button>
              );
            })}
          </div>
          {nonWorkdaySelected.length > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>
                {nonWorkdaySelected.map((d) => DAY_LABELS[d.code]).join(", ")}{" "}
                {nonWorkdaySelected.length === 1 ? "is" : "are"} outside your
                working days — they'll still be scheduled.
              </span>
            </p>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="space-y-3">
      {view === "month" && (
        <FormField
          control={form.control}
          name="byweeks"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <div className="flex items-center justify-between">
                <FormLabel className="text-xs font-semibold">On weeks</FormLabel>
                <SelectAll
                  id="rrule-all-weeks"
                  checked={allWeeksSelected}
                  onCheckedChange={setAllWeeks}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {weeks.map((w) => {
                  const active = field.value.includes(w.n);
                  return (
                    <button
                      key={w.n}
                      type="button"
                      onClick={() => toggleWeek(w.n)}
                      className={cn(
                        chipBase,
                        "flex items-center justify-between gap-1.5",
                        active ? chipActive : chipIdle,
                      )}
                    >
                      <span>Week {w.n}</span>
                      <span className="text-[10px] font-medium opacity-70">
                        {w.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {weekdayChips}

      <p className="text-[11px] text-muted-foreground">{boundHint}</p>
    </div>
  );
}

/** Small labeled "Select all" checkbox, right-aligned above a chip group. */
function SelectAll({
  id,
  checked,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted-foreground select-none"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="size-3.5"
      />
      Select all
    </label>
  );
}
