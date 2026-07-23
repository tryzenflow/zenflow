import { useCallback, useEffect, useRef, useState } from "react";
import { format, isSameDay } from "date-fns";
import type { DeadlineOptionsResponse } from "@zenflow/shared";
import { getDeadlineOptions } from "@/api/tasks";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedDate, zonedNow, zonedWallClockToUtc } from "@/utils/tz";
import { DAILY_HORIZON } from "@zenflow/core";
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
  editing,
}: {
  /** The resolved deadline, as a UTC ISO-8601 instant (or "" when unset). */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  /** Edit mode: an empty `value` just means the task hasn't loaded yet (its
   * real deadline is on the way via `form.reset`), NOT "unset" — so the
   * no-rush default below must not fire. */
  editing?: boolean;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [options, setOptions] = useState<DeadlineOptionsResponse | null>(null);
  const [chip, setChip] = useState<ChipId | null>(null);
  const [todayTomorrowMinutes, setTodayTomorrowMinutes] = useState(17 * 60);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [customMinutes, setCustomMinutes] = useState(17 * 60);
  // The last ISO string WE emitted via onChange, so the inference effect below
  // never fights a chip the user just picked (it only reacts to externally
  // driven value changes: initial edit-mode load, or `applySuggestion`).
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    // Anchor the deadline options to the current instant: "Today" now means
    // a few hours from now (rounded to the grid), not end-of-day.
    const anchor = zonedWallClockToUtc(zonedNow(tz), tz).toISOString();
    getDeadlineOptions(anchor)
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [tz]);

  useEffect(() => {
    if (!value || value === lastEmitted.current) return;
    const zoned = zonedDate(value, tz);
    if (options) {
      // Check if the calendar day matches (allows time adjustments on the same day)
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
      if (value === options.thisWeek) return setChip("thisWeek");
      if (value === options.nextWeek) return setChip("nextWeek");
      if (value === options.thisMonth) return setChip("thisMonth");
      if (value === options.noRush) return setChip("noRush");
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
    // Extract the calendar day and time from the server's value
    const baseDeadline = zonedDate(options[which], tz);
    const minutes = minutesOfDay(baseDeadline);
    setTodayTomorrowMinutes(minutes);
    emit(options[which]);
  };

  const handleTodayTomorrowTime = (minutes: number) => {
    setTodayTomorrowMinutes(minutes);
    if (!options || !chip || (chip !== "today" && chip !== "tomorrow")) return;
    // Preserve the calendar day from the server's value, adjust only the time
    const baseDeadline = zonedDate(options[chip], tz);
    const adjusted = new Date(baseDeadline);
    adjusted.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    emit(zonedWallClockToUtc(adjusted, tz).toISOString());
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

  // New-task default: a required field with nothing visibly selected reads
  // as broken, so once the options load, silently default to "No rush"
  // rather than leaving every chip unselected until the user picks one.
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (editing || defaultedRef.current || !options || value) return;
    defaultedRef.current = true;
    setChip("noRush");
    if (options) emit(options.noRush);
  }, [editing, options, value, emit]);

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
