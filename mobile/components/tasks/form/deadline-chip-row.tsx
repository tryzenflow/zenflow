import { getDeadlineOptions } from "@/api/tasks";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { zonedDate, zonedNow, zonedWallClockToUtc } from "@zenflow/core";
import { DAILY_HORIZON, type DeadlineOptionsResponse } from "@zenflow/shared";
import { format, isSameDay } from "date-fns";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { InlineDateField } from "./inline-date-field";
import { InlineTimeField } from "./inline-time-field";

type ChipId =
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "nextWeek"
  | "thisMonth"
  | "noRush"
  | "custom";

const CHIPS: { id: ChipId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "thisWeek", label: "This week" },
  { id: "nextWeek", label: "Next week" },
  { id: "thisMonth", label: "This month" },
  { id: "noRush", label: "No rush" },
  { id: "custom", label: "Custom" },
];

/** A safe "end of day" fallback (23:59) when a ceiling instant rolls onto a
 * different calendar day than the chip's target day — keeps the picker's
 * date on the chip's own day. */
const END_OF_DAY_MINUTES = DAILY_HORIZON - 1;

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Today's (or tomorrow's) wall-clock midnight, in user-tz local fields. */
function dayAnchor(tz: string, offsetDays: 0 | 1): Date {
  const day = zonedNow(tz);
  day.setHours(0, 0, 0, 0);
  if (offsetDays) day.setDate(day.getDate() + offsetDays);
  return day;
}

/** Combine a wall-clock day anchor + minutes-of-day into a real UTC instant. */
function combine(day: Date, minutes: number, tz: string): string {
  const wall = new Date(day);
  wall.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return zonedWallClockToUtc(wall, tz).toISOString();
}

/**
 * Deadline quick-action chip row — RN port of
 * `frontend/src/components/tasks/form/deadline-chip-field.tsx` (same logic,
 * unchanged: same six prefetched options from `GET /tasks/deadline-options`
 * plus Custom, same Today/Tomorrow/Custom time-of-day reveal, same "default
 * to No rush on create" behaviour). Only the picker widgets underneath
 * (`InlineTimeField`/`InlineDateField`) are RN-specific replacements for the
 * web's `<TimePicker>`/`<DatePicker>`.
 */
export function DeadlineChipRow({
  value,
  onChange,
  disabled,
  editing,
  tz,
}: {
  /** The resolved deadline, as a UTC ISO-8601 instant (or "" when unset). */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  /** Edit mode: an empty `value` just means the task hasn't loaded yet, NOT
   * "unset" — so the no-rush default below must not fire. */
  editing?: boolean;
  tz: string;
}) {
  const [options, setOptions] = useState<DeadlineOptionsResponse | null>(null);
  const [chip, setChip] = useState<ChipId | null>(null);
  const [todayTomorrowMinutes, setTodayTomorrowMinutes] =
    useState(END_OF_DAY_MINUTES);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [customMinutes, setCustomMinutes] = useState(17 * 60);
  // The last ISO string WE emitted via onChange, so the inference effect
  // below never fights a chip the user just picked.
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    const anchor = zonedWallClockToUtc(dayAnchor(tz, 0), tz).toISOString();
    getDeadlineOptions(anchor)
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [tz]);

  useEffect(() => {
    if (!value || value === lastEmitted.current) return;
    const zoned = zonedDate(value, tz);
    if (options) {
      const todayDate = zonedDate(options.today, tz);
      if (isSameDay(zoned, todayDate)) {
        setChip("today");
        setTodayTomorrowMinutes(minutesOfDay(zoned));
        return;
      }
      const tomorrowDate = zonedDate(options.tomorrow, tz);
      if (isSameDay(zoned, tomorrowDate)) {
        setChip("tomorrow");
        setTodayTomorrowMinutes(minutesOfDay(zoned));
        return;
      }
      if (value === options.thisWeek) {
        setChip("thisWeek");
        return;
      }
      if (value === options.nextWeek) {
        setChip("nextWeek");
        return;
      }
      if (value === options.thisMonth) {
        setChip("thisMonth");
        return;
      }
      if (value === options.noRush) {
        setChip("noRush");
        return;
      }
    }
    setChip("custom");
    setCustomDate(zoned);
    setCustomMinutes(minutesOfDay(zoned));
  }, [value, options, tz]);

  const emit = useCallback(
    (iso: string) => {
      lastEmitted.current = iso;
      onChange(iso);
    },
    [onChange],
  );

  const pickTodayTomorrow = (which: "today" | "tomorrow") => {
    setChip(which);
    if (!options) return;
    const baseDeadline = zonedDate(options[which], tz);
    setTodayTomorrowMinutes(minutesOfDay(baseDeadline));
    emit(options[which]);
  };

  const handleTodayTomorrowTime = (minutes: number) => {
    setTodayTomorrowMinutes(minutes);
    if (!options || !chip || (chip !== "today" && chip !== "tomorrow")) return;
    const baseDeadline = zonedDate(options[chip], tz);
    const adjusted = new Date(baseDeadline);
    adjusted.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    emit(zonedWallClockToUtc(adjusted, tz).toISOString());
  };

  const handleCustomDate = (date: Date) => {
    setCustomDate(date);
    emit(combine(date, customMinutes, tz));
  };

  const handleCustomTime = (minutes: number) => {
    setCustomMinutes(minutes);
    if (customDate) emit(combine(customDate, minutes, tz));
  };

  const pick = (id: ChipId) => {
    if (id === "today" || id === "tomorrow") return pickTodayTomorrow(id);
    setChip(id);
    if (id === "custom" || !options) return;
    emit(options[id]);
  };

  // New-task default: a required field with nothing visibly selected reads
  // as broken, so once the options load, silently default to "No rush"
  // rather than leaving every chip unselected until the user picks one.
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (editing || defaultedRef.current || !options || value) return;
    defaultedRef.current = true;
    setChip("noRush");
    emit(options.noRush);
  }, [editing, options, value, emit]);

  const preview = value
    ? format(zonedDate(value, tz), "EEE MMM d, h:mm a")
    : null;

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-1.5">
        {CHIPS.map((c) => {
          const chipDisabled = disabled || (!options && c.id !== "custom");
          return (
            <Pressable
              key={c.id}
              disabled={chipDisabled}
              onPress={() => pick(c.id)}
              className={cn(
                "rounded-full border px-2.5 py-1",
                chip === c.id
                  ? "border-primary bg-primary/15"
                  : "border-border bg-muted",
                chipDisabled && "opacity-50",
              )}
            >
              <Text
                className={cn(
                  "text-[11px] font-semibold",
                  chip === c.id ? "text-primary" : "text-muted-foreground",
                )}
              >
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {(chip === "today" || chip === "tomorrow") && (
        <InlineTimeField
          value={todayTomorrowMinutes}
          onChange={handleTodayTomorrowTime}
          disabled={disabled}
          label={chip === "today" ? "Due today at" : "Due tomorrow at"}
        />
      )}

      {chip === "custom" && (
        <View className="flex-row gap-2">
          <View className="flex-1">
            <InlineDateField
              value={customDate}
              onChange={handleCustomDate}
              tz={tz}
              disabled={disabled}
            />
          </View>
          <View className="flex-1">
            <InlineTimeField
              value={customMinutes}
              onChange={handleCustomTime}
              disabled={disabled}
              label="Due at"
            />
          </View>
        </View>
      )}

      {preview && (
        <Text className="text-[11px] text-muted-foreground">Due {preview}</Text>
      )}
    </View>
  );
}
