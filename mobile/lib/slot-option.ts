import { zonedDate } from "@zenflow/core";
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  format,
  isSameDay,
} from "date-fns";

/** `7:00 – 8:00 PM` when both ends share a half-day, `11:00 AM – 12:00 PM`
 * when the range crosses meridiem — matches the week-view mockup blocks. */
export function formatRange(start: Date, end: Date): string {
  const sameHalf = (start.getHours() < 12) === (end.getHours() < 12);
  return sameHalf
    ? `${format(start, "h:mm")} – ${format(end, "h:mm a")}`
    : `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
}

/**
 * Relative day word in user-tz space (never the device clock): "today" /
 * "tomorrow", else `EEE MMM d` ("Wed Jul 1").
 *
 * `now` is a parameter rather than a clock read so the relative words are
 * deterministic under test; callers pass `zonedNow(tz)`. Both arguments are
 * already user-tz wall clock, so a plain `isSameDay` is correct here.
 */
export function dayWord(date: Date, now: Date): string {
  if (isSameDay(date, now)) return "today";
  if (isSameDay(date, addDays(now, 1))) return "tomorrow";
  return format(date, "EEE MMM d");
}

const capitalize = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);

/** One selectable side of a slot comparison. */
export interface SlotOption {
  kind: "primary" | "alternative";
  /** `"Sat Jul 4 · 10:00 – 11:00 AM"` — day first, always. */
  label: string;
  /** `"10:00 AM"` — for the single-session sheet's footer buttons. */
  time: string;
  /** `"Sat Jul 4"` / `"today"` / `"tomorrow"`. */
  day: string;
  hint: string;
  /**
   * `"+1 day"` / `"−1 day"` / `""` — how far the alternative sits from the
   * primary in days, so a cross-day alternative reads as a different DAY and
   * not a time-of-day tweak.
   */
  dayDelta: string;
}

export interface SlotOptionInput {
  primarySlot: string;
  alternativeSlot: string;
  durationMinutes: number;
}

/**
 * The two cards for one sitting, in `[primary, alternative]` order.
 *
 * Each option carries its own day. The heuristic and LinUCB plans are
 * independent, so an alternative can land on a different DATE than the primary
 * (issue #59) — a card printing only a time would misread that as a
 * same-day tweak.
 */
export function buildSlotOptions(
  input: SlotOptionInput,
  tz: string,
  now: Date,
): [SlotOption, SlotOption] {
  const primary = zonedDate(input.primarySlot, tz);
  const alternative = zonedDate(input.alternativeSlot, tz);
  const dur = input.durationMinutes;

  const primaryDay = dayWord(primary, now);
  const alternativeDay = dayWord(alternative, now);

  const offset = differenceInCalendarDays(alternative, primary);
  const dayDelta =
    offset === 0
      ? ""
      : offset > 0
        ? `+${offset} day${offset > 1 ? "s" : ""}`
        : `−${Math.abs(offset)} day${Math.abs(offset) > 1 ? "s" : ""}`;

  return [
    {
      kind: "primary",
      label: `${capitalize(primaryDay)} · ${formatRange(primary, addMinutes(primary, dur))}`,
      time: format(primary, "h:mm a"),
      day: primaryDay,
      hint: "Currently scheduled",
      dayDelta: "",
    },
    {
      kind: "alternative",
      label: `${capitalize(alternativeDay)} · ${formatRange(alternative, addMinutes(alternative, dur))}`,
      time: format(alternative, "h:mm a"),
      day: alternativeDay,
      hint: "Also fits before the deadline",
      dayDelta,
    },
  ];
}
