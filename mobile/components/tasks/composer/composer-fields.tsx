import { getDeadlineOptions } from "@/api/tasks";
import { useLanguage } from "@/hooks/use-language";
import { useComposerStore } from "@/lib/composer-store";
import { t } from "@/lib/i18n";
import { sittingMinutes } from "@/lib/split-sittings";
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
  type SessionFormValues,
  hhmmToMinutes,
  maxFeasibleSessionCount,
  zonedDate,
  zonedNow,
  zonedWallClockToUtc,
} from "@zenflow/core";
import type { DeadlineOptionsResponse } from "@zenflow/shared";
import { format, isSameDay } from "date-fns";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { UseFormReturn } from "react-hook-form";

/** Deadline time of day when a date is chosen without one: 23:59:59. */
export const END_OF_DAY = 23 * 60 + 59;
export const END_OF_DAY_SECONDS = 59;

/** Most sittings the split stepper offers. The server allows more; this keeps the strip readable. */
const MAX_SPLIT_CHOICES = 8;

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
  return format(zonedNow(tz), "yyyy-MM-dd");
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
  const customDate = due ? format(due, "yyyy-MM-dd") : todayIn(tz);
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

/**
 * Length of the task as chips (30 min, 1 h, 2 h, 3 h) and Custom, which reveals
 * a slider in 15 minute steps.
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
  const isChoice = (DURATION_CHOICES as readonly number[]).includes(value);
  const customActive = customOpen || !isChoice;
  const error = form.formState.errors.duration?.message;

  return (
    <FieldCard label="Duration" error={error} testID="task.duration">
      <ChipGroup<string>
        testID="task.duration.chip"
        value={customActive ? null : String(value)}
        disabled={disabled}
        onChange={(v) => {
          setCustomOpen(false);
          form.setValue("duration", Number(v), { shouldValidate: true });
        }}
        onCustom={() => setCustomOpen(true)}
        customActive={customActive}
        options={DURATION_CHOICES.map((m) => ({ value: String(m), label: durationLabel(m) }))}
      />
      {customActive && (
        <DurationSlider
          testID="task.duration.slider"
          label="Duration"
          value={value}
          max={480}
          disabled={disabled}
          onChange={(v) => form.setValue("duration", v, { shouldValidate: true })}
        />
      )}
    </FieldCard>
  );
}

/**
 * How many sittings the task splits into, with a strip that shows each sitting
 * at its length. Sittings are capped at what fits before the deadline.
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
  const count = form.watch("sessionCount") ?? 1;
  const duration = form.watch("duration") ?? 60;
  const deadline = form.watch("deadline") || undefined;
  const feasible = Math.min(
    MAX_SPLIT_CHOICES,
    maxFeasibleSessionCount(deadline, duration, from),
  );
  const tooMany = count > feasible;
  const parts = sittingMinutes(duration, count);

  function set(next: number) {
    const bounded = Math.max(1, Math.min(next, Math.max(1, feasible)));
    form.setValue("sessionCount", bounded, { shouldValidate: true });
  }

  return (
    <FieldCard
      label="Split into sittings"
      hint="One sitting per day at most, each one placed on its own."
      error={
        tooMany
          ? t("Only {count} sittings fit before the deadline.", { count: feasible })
          : undefined
      }
      testID="task.split"
      trailing={
        <View className="flex-row items-center gap-3">
          <Pressable
            testID="task.split.minus"
            disabled={disabled || count <= 1}
            onPress={() => set(count - 1)}
            accessibilityLabel={t("Fewer sittings")}
            className={cn(
              "size-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70",
              (disabled || count <= 1) && "opacity-40",
            )}
          >
            <Text className="text-2xl text-foreground">−</Text>
          </Pressable>
          <Text
            testID="task.split.count"
            className="min-w-[24px] text-center text-[17px] font-semibold tabular-nums text-foreground"
          >
            {count}
          </Text>
          <Pressable
            testID="task.split.plus"
            disabled={disabled || count >= feasible}
            onPress={() => set(count + 1)}
            accessibilityLabel={t("More sittings")}
            className={cn(
              "size-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70",
              (disabled || count >= feasible) && "opacity-40",
            )}
          >
            <Text className="text-2xl text-foreground">+</Text>
          </Pressable>
        </View>
      }
    >
      <View testID="task.split.strip" className="flex-row gap-1.5">
        {parts.map((minutes, i) => (
          <View
            key={i}
            className="h-11 flex-1 items-center justify-center rounded-lg border border-primary/35 bg-primary/15"
            style={{ flexGrow: minutes }}
          >
            <Text className="text-[11px] font-semibold tabular-nums text-primary">
              {durationLabel(minutes)}
            </Text>
          </View>
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
          className="h-[50px] rounded-xl border border-glass-edge/35 bg-glass/70 dark:bg-glass/[0.07] px-4 text-base text-foreground dark:border-glass-edge/25"
        />
      )}
    </FieldCard>
  );
}
