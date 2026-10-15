import { StepperButton } from "@/components/ui/stepper-button";
import { getDeadlineOptions } from "@/api/tasks";
import { useLanguage } from "@/hooks/use-language";
import { useComposerStore } from "@/lib/composer-store";
import { t } from "@/lib/i18n";
import {
  defaultSittingCount,
  sittingMinutes,
  snapCount,
  splitCounts,
} from "@/lib/split-sittings";
import { clockLabel } from "@/lib/slider-math";
import { BottomSheetTextInput } from "@/components/ui/bottom-sheet";
import { ChipGroup } from "@/components/ui/chip-group";
import { DurationSlider, durationLabel } from "@/components/ui/duration-slider";
import { FieldCard } from "@/components/ui/field-card";
import { Text } from "@/components/ui/text";
import { TimelineTimePicker } from "@/components/ui/timeline-time-picker";
import { WeekStripDatePicker } from "@/components/ui/week-strip-date-picker";
import { cn } from "@/lib/utils";
import {
  MAX_TASK_SESSION_COUNT,
  MAX_TASK_TOTAL_MINUTES,
  type SessionFormValues,
  hhmmToMinutes,
  maxFeasibleSessionCount,
  zonedDate,
  zonedNow,
  zonedWallClockToUtc,
} from "@zenflow/core";
import type { DeadlineOptionsResponse } from "@zenflow/shared";
import { isSameDay } from "date-fns";
import { format as dateFnsFormat } from "date-fns";
import { format as localFormat } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { UseFormReturn } from "react-hook-form";

/** Deadline time of day when a date is chosen without one: 23:59:59. */
export const END_OF_DAY = 23 * 60 + 59;
export const END_OF_DAY_SECONDS = 59;


/**
 * A wall-clock date (`YYYY-MM-DD`) and minutes of day, as one UTC instant.
 * `seconds` is 59 for an end-of-day deadline, which is how the server's
 * "today", "tomorrow" and "no rush" options are stamped.
 */
export function isoAt(date: string, minutes: number, tz: string, seconds = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  const wall = new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, seconds, 0);
  return zonedWallClockToUtc(wall, tz).toISOString();
}

/** The user's calendar day for `tz`, as `YYYY-MM-DD`. */
export function todayIn(tz: string): string {
  return dateFnsFormat(zonedNow(tz), "yyyy-MM-dd");
}

type DeadlineChipId = "today" | "tomorrow" | "thisWeek" | "nextWeek" | "noRush";

const DEADLINE_CHIPS: { value: DeadlineChipId; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "thisWeek", label: "This week" },
  { value: "nextWeek", label: "Next week" },
  { value: "noRush", label: "No rush" },
];

/** Which quick chip a deadline instant matches, or `null` for a custom one. */
function chipOf(
  value: string,
  options: DeadlineOptionsResponse | null,
  tz: string,
): DeadlineChipId | null {
  if (!value || !options) return null;
  if (value === options.noRush) return "noRush";
  if (value === options.thisWeek) return "thisWeek";
  if (value === options.nextWeek) return "nextWeek";
  const due = zonedDate(value, tz);
  if (isSameDay(due, zonedDate(options.today, tz))) return "today";
  if (isSameDay(due, zonedDate(options.tomorrow, tz))) return "tomorrow";
  return null;
}

/**
 * Deadline as quick chips (today, tomorrow, this week, next week, no rush) and
 * Custom, which reveals a date strip and a time line. A new task defaults to
 * "No rush" so nothing reads as unset.
 */
export function DeadlineField({
  form,
  tz,
  editing,
  disabled,
}: {
  form: UseFormReturn<SessionFormValues>;
  tz: string;
  editing?: boolean;
  disabled?: boolean;
}) {
  useLanguage();
  const value = form.watch("deadline") ?? "";
  const error = form.formState.errors.deadline?.message;
  const [options, setOptions] = useState<DeadlineOptionsResponse | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const chip = chipOf(value, options, tz);
  const customActive = customOpen || (!!value && chip === null);

  useEffect(() => {
    const anchor = zonedWallClockToUtc(zonedNow(tz), tz).toISOString();
    getDeadlineOptions(anchor)
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [tz]);

  useEffect(() => {
    if (editing || value || !options) return;
    form.setValue("deadline", options.noRush);
  }, [editing, options, value, form]);

  const emit = (iso: string) => form.setValue("deadline", iso, { shouldValidate: true });

  function pick(id: DeadlineChipId) {
    setCustomOpen(false);
    if (options) emit(options[id]);
  }

  function openCustom() {
    setCustomOpen(true);
    if (!value) emit(isoAt(todayIn(tz), END_OF_DAY, tz, END_OF_DAY_SECONDS));
  }

  const due = value ? zonedDate(value, tz) : null;
  const customDate = due ? dateFnsFormat(due, "yyyy-MM-dd") : todayIn(tz);
  const customMinutes = due ? due.getHours() * 60 + due.getMinutes() : END_OF_DAY;

  return (
    <FieldCard label="Deadline" error={error} testID="task.deadline">
      <ChipGroup<DeadlineChipId>
        testID="task.deadline.chip"
        value={customActive ? null : chip}
        disabled={disabled || !options}
        onChange={pick}
        onCustom={openCustom}
        customActive={customActive}
        options={DEADLINE_CHIPS}
      />
      {due ? (
        <Text testID="task.deadline.readout" className="text-[15px] font-medium text-foreground">
          {t("Due {when}", { when: localFormat(due, "EEE MMM d, HH:mm") })}
        </Text>
      ) : null}
      {customActive && (
        <View className="gap-4">
          <WeekStripDatePicker
            testID="task.deadline.date"
            value={customDate}
            minDate={todayIn(tz)}
            disabled={disabled}
            onChange={(date) => emit(isoAt(date, customMinutes, tz))}
          />
          <TimelineTimePicker
            testID="task.deadline.time"
            label="Deadline time"
            value={customMinutes}
            disabled={disabled}
            onChange={(minutes) => emit(isoAt(customDate, minutes, tz))}
          />
        </View>
      )}
    </FieldCard>
  );
}

const DURATION_CHOICES = [30, 60, 120, 180] as const;

/** One day of work in the Days unit. */
const WORK_DAY_MINUTES = 8 * 60;
/** Longest total the Hours unit offers; Days covers the rest. */
const HOURS_MAX = 12 * 60;

type DurationUnit = "hours" | "days";

const DURATION_UNITS: { value: DurationUnit; label: string }[] = [
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];

/** "2 days (16 h)": half days on the 15-minute grid. */
function workDaysLabel(minutes: number): string {
  const days = minutes / WORK_DAY_MINUTES;
  return t("{days} days ({hours})", {
    days: Number.isInteger(days) ? String(days) : days.toFixed(1),
    hours: durationLabel(minutes),
  });
}

/**
 * Length of the whole task as chips (30 min, 1 h, 2 h, 3 h) and Custom, which
 * reveals Hours (15 minute steps up to 12 h) or Days (half days of 8 h work,
 * up to 120 h). The split below follows the total.
 */
export function DurationField({
  form,
  disabled,
}: {
  form: UseFormReturn<SessionFormValues>;
  disabled?: boolean;
}) {
  useLanguage();
  const value = form.watch("duration") ?? 60;
  const [customOpen, setCustomOpen] = useState(false);
  const [unit, setUnit] = useState<DurationUnit>(
    value > HOURS_MAX ? "days" : "hours",
  );
  const isChoice = (DURATION_CHOICES as readonly number[]).includes(value);
  const customActive = customOpen || !isChoice;
  const error = form.formState.errors.duration?.message;

  function setDuration(minutes: number) {
    form.setValue("duration", minutes, { shouldValidate: true });
    form.setValue("sessionCount", defaultSittingCount(minutes), {
      shouldValidate: true,
    });
  }

  function pickUnit(next: DurationUnit) {
    setUnit(next);
    if (next === "days" && value < WORK_DAY_MINUTES) setDuration(WORK_DAY_MINUTES);
    if (next === "hours" && value > HOURS_MAX) setDuration(HOURS_MAX);
  }

  return (
    <FieldCard label="Duration" error={error} testID="task.duration">
      <ChipGroup<string>
        testID="task.duration.chip"
        value={customActive ? null : String(value)}
        disabled={disabled}
        onChange={(v) => {
          setCustomOpen(false);
          setDuration(Number(v));
        }}
        onCustom={() => setCustomOpen(true)}
        customActive={customActive}
        options={DURATION_CHOICES.map((m) => ({ value: String(m), label: durationLabel(m) }))}
      />
      {customActive && (
        <View className="gap-3">
          <ChipGroup<DurationUnit>
            testID="task.duration.unit"
            value={unit}
            disabled={disabled}
            onChange={pickUnit}
            options={DURATION_UNITS}
          />
          {unit === "hours" ? (
            <DurationSlider
              testID="task.duration.slider"
              label="Duration"
              value={Math.min(value, HOURS_MAX)}
              max={HOURS_MAX}
              disabled={disabled}
              onChange={setDuration}
            />
          ) : (
            <DurationSlider
              testID="task.duration.days"
              label="Duration"
              value={Math.max(value, WORK_DAY_MINUTES)}
              min={WORK_DAY_MINUTES}
              max={MAX_TASK_TOTAL_MINUTES}
              step={WORK_DAY_MINUTES / 2}
              valueLabel={workDaysLabel}
              disabled={disabled}
              onChange={setDuration}
            />
          )}
        </View>
      )}
    </FieldCard>
  );
}

/**
 * How many sittings the task splits into. When creating, the duration above is
 * the whole task and it splits into sittings within 15 minutes of each other;
 * when editing, each sitting keeps its length and the count grows or shrinks
 * the series.
 */
export function SplitField({
  form,
  disabled,
  from,
}: {
  form: UseFormReturn<SessionFormValues>;
  disabled?: boolean;
  /** Start of the window the deadline is measured from (edit mode only). */
  from?: Date;
}) {
  useLanguage();
  const splitTotal = form.watch("splitTotal") ?? false;
  const count = form.watch("sessionCount") ?? 1;
  const duration = form.watch("duration") ?? 60;
  const deadline = form.watch("deadline") || undefined;

  // Creating: the divisors of the total. Editing: every count that fits.
  const counts = useMemo(() => {
    if (splitTotal) return splitCounts(duration);
    const feasible = Math.min(
      MAX_TASK_SESSION_COUNT,
      Math.max(1, maxFeasibleSessionCount(deadline, duration, from)),
    );
    return Array.from({ length: feasible }, (_, i) => i + 1);
  }, [splitTotal, duration, deadline, from]);

  // A shorter total can leave the count invalid: step down to one that divides.
  useEffect(() => {
    if (!counts.includes(count)) {
      form.setValue("sessionCount", snapCount(counts, count), { shouldValidate: true });
    }
  }, [counts, count, form]);

  const parts = splitTotal
    ? sittingMinutes(duration, count)
    : Array.from({ length: count }, () => duration);
  const each = parts[0];
  const last = parts[parts.length - 1];
  const longer = parts.filter((m) => m === each).length;
  const index = Math.max(0, counts.indexOf(count));

  function step(dir: -1 | 1) {
    const next = counts[index + dir];
    if (next != null) form.setValue("sessionCount", next, { shouldValidate: true });
  }

  return (
    <FieldCard
      label="Split into sittings"
      hint={splitTotal ? "Splits the task into shorter sessions." : undefined}
      testID="task.split"
      trailing={
        <View className="flex-row items-center gap-3">
          <StepperButton
            testID="task.split.minus"
            glyph="−"
            disabled={disabled || index <= 0}
            onPress={() => step(-1)}
            accessibilityLabel={t("Fewer sittings")}
          />
          <Text
            testID="task.split.count"
            className="min-w-[24px] text-center text-[17px] font-semibold tabular-nums text-foreground"
          >
            {count}
          </Text>
          <StepperButton
            testID="task.split.plus"
            glyph="+"
            disabled={disabled || index >= counts.length - 1}
            onPress={() => step(1)}
            accessibilityLabel={t("More sittings")}
          />
        </View>
      }
    >
      <Text testID="task.split.summary" className="text-[15px] font-medium text-foreground">
        {count === 1
          ? durationLabel(duration)
          : last !== each
            ? t("{count} sittings of {duration} and {rest} of {last}", {
                count: longer,
                duration: durationLabel(each),
                rest: count - longer,
                last: durationLabel(last),
              })
            : t("{count} sittings of {duration}", { count, duration: durationLabel(each) })}
      </Text>
      <View
        testID="task.split.strip"
        className={cn("flex-row", parts.length > 12 ? "gap-0.5" : "gap-1.5")}
      >
        {parts.map((minutes, i) => (
          <View
            key={i}
            className={cn(
              "h-9 border border-primary/35 bg-primary/15",
              parts.length > 12 ? "rounded-sm" : "rounded-lg",
            )}
            style={{ flexGrow: minutes, flexShrink: 1, flexBasis: 0 }}
          />
        ))}
      </View>
    </FieldCard>
  );
}

const EVENT_MIN = 15;
const EVENT_MAX = 360;

/**
 * Date, start time and length for a fixed event. Length sets the end time, so
 * the form's start and end always agree.
 */
export function EventWhenField({
  form,
  tz,
  disabled,
}: {
  form: UseFormReturn<SessionFormValues>;
  tz: string;
  disabled?: boolean;
}) {
  useLanguage();
  const date = form.watch("date") || todayIn(tz);
  const startMinutes = hhmmToMinutes(form.watch("startTime") || "09:00");
  const endMinutes = hhmmToMinutes(form.watch("endTime") || "10:00");
  const duration = Math.max(EVENT_MIN, endMinutes - startMinutes);
  const error =
    form.formState.errors.date?.message ??
    form.formState.errors.startTime?.message ??
    form.formState.errors.endTime?.message;

  function setTimes(start: number, length: number) {
    form.setValue("startTime", clockLabel(start), { shouldValidate: true });
    form.setValue("endTime", clockLabel(start + length), { shouldValidate: true });
  }

  return (
    <FieldCard label="When" error={error} testID="task.when">
      <WeekStripDatePicker
        testID="task.when.date"
        value={date}
        disabled={disabled}
        onChange={(d) => form.setValue("date", d, { shouldValidate: true })}
      />
      <TimelineTimePicker
        testID="task.when.start"
        label="Start time"
        value={startMinutes}
        max={24 * 60 - duration}
        disabled={disabled}
        onChange={(m) => setTimes(m, duration)}
      />
      <DurationSlider
        testID="task.when.length"
        label="Length"
        value={duration}
        min={EVENT_MIN}
        max={EVENT_MAX}
        disabled={disabled}
        onChange={(len) => setTimes(startMinutes, len)}
      />
    </FieldCard>
  );
}

/**
 * Course as chips: the user's recent courses plus "No course", and Other for a
 * new name. A course is the first tag of the task. Picking one recalls the
 * duration last used for it.
 */
export function CourseField({
  form,
  courses,
  disabled,
}: {
  form: UseFormReturn<SessionFormValues>;
  courses: string[];
  disabled?: boolean;
}) {
  useLanguage();
  const tags = form.watch("tags") ?? [];
  const current = tags[0] ?? "";
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  const recent = courses.filter((c) => c !== current).slice(0, 3);
  const shown = current ? [current, ...recent] : recent;

  function setCourse(name: string) {
    const rest = tags.slice(1);
    form.setValue("tags", name ? [name, ...rest] : rest);
    setOtherOpen(false);
    if (!name || form.getValues("type") !== "TASK") return;
    const remembered = useComposerStore.getState().courseDuration[name];
    if (remembered) form.setValue("duration", remembered, { shouldValidate: true });
  }

  return (
    <FieldCard label="Course" hint="Other tags go under More options." testID="task.course">
      <ChipGroup<string>
        testID="task.course.chip"
        value={otherOpen ? null : current}
        disabled={disabled}
        onChange={setCourse}
        onCustom={() => {
          setOtherOpen(true);
          setOtherText("");
        }}
        customActive={otherOpen}
        customLabel="Other"
        options={[{ value: "", label: "No course" }, ...shown.map((c) => ({ value: c, label: c }))]}
      />
      {otherOpen && (
        <BottomSheetTextInput
          testID="task.course.input"
          autoFocus
          value={otherText}
          onChangeText={setOtherText}
          onSubmitEditing={() => setCourse(otherText.trim())}
          returnKeyType="done"
          placeholder={t("Course name")}
          accessibilityLabel={t("Course name")}
          className="h-12 rounded-xl border border-glass-edge/35 bg-glass/70 dark:bg-glass/[0.07] px-5 text-[17px] text-foreground dark:border-glass-edge/25"
        />
      )}
    </FieldCard>
  );
}
