import { useEffect, useRef, useState } from "react";
import { format, isSameDay } from "date-fns";
import type { DeadlineOptionsResponse } from "@zenflow/shared";
import { getDeadlineOptions } from "@/api/tasks";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedDate, zonedNow, zonedWallClockToUtc } from "@/utils/tz";
import { DAILY_HORIZON } from "@/utils/constants";
import { DatePicker } from "@/components/ui/datepicker";
import { TimePicker } from "@/components/ui/time-picker";
import { cn } from "@/lib/utils";

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
 * different calendar day than the chip's target day (e.g. a bare midnight or
 * a night-owl wrap) — keeps the picker's date on the chip's own day. */
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

/** Seed the time-picker from the backend's ceiling ISO, falling back to
 * end-of-day when the ceiling instant doesn't land on `targetDay`. */
function seedMinutes(iso: string, targetDay: Date, tz: string): number {
  const zoned = zonedDate(iso, tz);
  return isSameDay(zoned, targetDay) ? minutesOfDay(zoned) : END_OF_DAY_MINUTES;
}

/** Combine a wall-clock day anchor + minutes-of-day into a real UTC instant. */
function combine(day: Date, minutes: number, tz: string): string {
  const wall = new Date(day);
  wall.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return zonedWallClockToUtc(wall, tz).toISOString();
}

/**
 * Deadline quick-action chip row (todo.md): Today / Tomorrow / This week /
 * Next week / This month / No rush / Custom. The six non-custom values are
 * prefetched once (via `GET /tasks/deadline-options`) so every chip click is
 * instant. Today/Tomorrow/Custom additionally reveal a {@link TimePicker} (and
 * Custom a {@link DatePicker}) so the user can fine-tune the exact instant;
 * for Today/Tomorrow the calendar day stays pinned to that chip's day — only
 * the time is user-editable.
 */
export function DeadlineChipField({
  value,
  onChange,
  disabled,
}: {
  /** The resolved deadline, as a UTC ISO-8601 instant (or "" when unset). */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [options, setOptions] = useState<DeadlineOptionsResponse | null>(null);
  const [chip, setChip] = useState<ChipId | null>(null);
  const [todayTomorrowMinutes, setTodayTomorrowMinutes] =
    useState(END_OF_DAY_MINUTES);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [customMinutes, setCustomMinutes] = useState(17 * 60);
  // The last ISO string WE emitted via onChange, so the inference effect below
  // never fights a chip the user just picked (it only reacts to externally
  // driven value changes: initial edit-mode load, or `applySuggestion`).
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    getDeadlineOptions(new Date().toISOString())
      .then(setOptions)
      .catch(() => setOptions(null));
  }, []);

  useEffect(() => {
    if (!value || value === lastEmitted.current) return;
    const zoned = zonedDate(value, tz);
    if (options) {
      if (value === options.today) {
        setChip("today");
        setTodayTomorrowMinutes(seedMinutes(options.today, dayAnchor(tz, 0), tz));
        return;
      }
      if (value === options.tomorrow) {
        setChip("tomorrow");
        setTodayTomorrowMinutes(
          seedMinutes(options.tomorrow, dayAnchor(tz, 1), tz),
        );
        return;
      }
      if (value === options.thisWeek) return setChip("thisWeek");
      if (value === options.nextWeek) return setChip("nextWeek");
      if (value === options.thisMonth) return setChip("thisMonth");
      if (value === options.noRush) return setChip("noRush");
    }
    setChip("custom");
    setCustomDate(zoned);
    setCustomMinutes(minutesOfDay(zoned));
  }, [value, options, tz]);

  const emit = (iso: string) => {
    lastEmitted.current = iso;
    onChange(iso);
  };

  const pickTodayTomorrow = (which: "today" | "tomorrow") => {
    setChip(which);
    const target = dayAnchor(tz, which === "tomorrow" ? 1 : 0);
    const minutes = options
      ? seedMinutes(options[which], target, tz)
      : END_OF_DAY_MINUTES;
    setTodayTomorrowMinutes(minutes);
    emit(combine(target, minutes, tz));
  };

  const handleTodayTomorrowTime = (minutes: number) => {
    setTodayTomorrowMinutes(minutes);
    const target = dayAnchor(tz, chip === "tomorrow" ? 1 : 0);
    emit(combine(target, minutes, tz));
  };

  const handleCustomDate = (date: Date | undefined) => {
    setCustomDate(date);
    if (date) emit(combine(date, customMinutes, tz));
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

  const preview = value
    ? format(zonedDate(value, tz), "EEE MMM d, h:mm a")
    : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={disabled || (!options && c.id !== "custom")}
            onClick={() => pick(c.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50",
              chip === c.id
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {(chip === "today" || chip === "tomorrow") && (
        <TimePicker
          value={todayTomorrowMinutes}
          onChange={handleTodayTomorrowTime}
          disabled={disabled}
          className="w-full"
        />
      )}

      {chip === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <DatePicker
            placeholder="Select date"
            disabled={disabled || { before: new Date() }}
            date={customDate}
            onSelect={handleCustomDate}
          />
          <TimePicker
            value={customMinutes}
            onChange={handleCustomTime}
            disabled={disabled}
          />
        </div>
      )}

      {preview && (
        <p className="text-[11px] text-muted-foreground">Due {preview}</p>
      )}
    </div>
  );
}
