import { useLanguage } from "@/hooks/use-language";
import { format, t } from "@/lib/i18n";
import { getDeadlineOptions } from "@/api/tasks";
import { Check } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { haptic } from "@/lib/haptics";
import { TimePickerInline } from "@/components/ui/time-picker";
import { cn } from "@/lib/utils";
import { zonedDate, zonedNow, zonedWallClockToUtc } from "@zenflow/core";
import type { DeadlineOptionsResponse } from "@zenflow/shared";
import { addDays, isSameDay } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { InlineDateField } from "./inline-date-field";

/** Custom deadlines can't be set further out than this many days from now. */
const MAX_CUSTOM_DEADLINE_DAYS = 60;

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

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
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
 * same six prefetched options from `GET /tasks/deadline-options` plus Custom,
 * same Today/Tomorrow/Custom time-of-day reveal). Unlike web there is no
 * preselected chip: a deadline is required, and "No rush" is an explicit choice
 * (the backend resolves it to the end of next month, a real instant). The
 * picker widgets underneath (`TimePickerInline`/`InlineDateField`) are
 * RN-specific replacements for the web's `<TimePicker>`/`<DatePicker>`.
 */
export function DeadlineChipRow({
  value,
  onChange,
  disabled,
  tz,
}: {
  /** The resolved deadline, as a UTC ISO-8601 instant (or "" when unset). */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  tz: string;
}) {
  useLanguage();
  const [options, setOptions] = useState<DeadlineOptionsResponse | null>(null);
  const [chip, setChip] = useState<ChipId | null>(null);
  const [todayTomorrowMinutes, setTodayTomorrowMinutes] = useState(17 * 60);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [customMinutes, setCustomMinutes] = useState(17 * 60);
  // The last ISO string WE emitted via onChange, so the inference effect
  // below never fights a chip the user just picked.
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    // The current instant, not midnight-of-today — the backend's "today"
    // option is now a few hours from now (rounded to the 15-minute grid),
    // so it needs the actual moment, mirroring the frontend's anchor.
    const anchor = zonedWallClockToUtc(zonedNow(tz), tz).toISOString();
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
    if (id !== chip) haptic.select();
    if (id === "today" || id === "tomorrow") return pickTodayTomorrow(id);
    setChip(id);
    if (id === "custom" || !options) return;
    emit(options[id]);
  };

  // App language and clock: "Tue Oct 7 · 5:00 PM" / "T3, 7/10 · 17:00".
  const preview = value
    ? `${format(zonedDate(value, tz), "EEE MMM d")} · ${format(zonedDate(value, tz), "h:mm a")}`
    : null;

  // Hard cap on how far out a Custom deadline can be set (max 60 days).
  const maxCustomDate = useMemo(
    () => addDays(zonedNow(tz), MAX_CUSTOM_DEADLINE_DAYS),
    [tz],
  );

  return (
    <View className="gap-2">
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Deadline")}
        className="flex-row flex-wrap gap-2"
      >
        {CHIPS.map((c) => {
          const chipDisabled = disabled || (!options && c.id !== "custom");
          const selected = chip === c.id;
          return (
            <Pressable
              key={c.id}
              disabled={chipDisabled}
              onPress={() => pick(c.id)}
              accessibilityRole="radio"
              accessibilityLabel={t(c.label)}
              accessibilityState={{ selected, disabled: !!chipDisabled }}
              className={cn(
                "min-h-11 flex-row items-center justify-center gap-1 rounded-full border px-3.5",
                selected
                  ? "border-2 border-primary-text bg-primary/15"
                  : "border-border bg-muted",
                chipDisabled && "opacity-50",
              )}
            >
              {selected && <Check size={14} className="text-primary-text" />}
              <Text
                className={cn(
                  "text-[13px] font-semibold",
                  selected ? "text-primary-text" : "text-foreground",
                )}
              >
                {t(c.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {(chip === "today" || chip === "tomorrow") && (
        <TimePickerInline
          value={todayTomorrowMinutes}
          onChange={handleTodayTomorrowTime}
          disabled={disabled}
          label={chip === "today" ? t("Due today at") : t("Due tomorrow at")}
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
              maxDate={maxCustomDate}
            />
          </View>
          <View className="flex-1">
            <TimePickerInline
              value={customMinutes}
              onChange={handleCustomTime}
              disabled={disabled}
              label={t("Due at")}
            />
          </View>
        </View>
      )}

      {preview && (
        <Text className="text-xs text-muted-foreground">
          {t("Due {date}", { date: preview })}
        </Text>
      )}
    </View>
  );
}
