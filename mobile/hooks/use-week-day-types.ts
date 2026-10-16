import { listSessions } from "@/api/tasks";
import { dateKey, weekStart } from "@/lib/week-date-math";
import { dayBarsByDay, sameDayBars } from "@/lib/day-bar";
import type { Session } from "@zenflow/shared";
import { useUserStore } from "@/hooks/use-user-store";
import {
  type DayTypes,
  clearWeekTypesCache,
  getCachedWeekTypes,
  setCachedWeekTypes,
} from "@/lib/week-day-types-cache";
import {
  getCachedDaySessions,
  getCachedMonthSessions,
} from "@/lib/session-cache";
import { addDays } from "date-fns";
import { useEffect, useRef, useState } from "react";

/**
 * Per-day distinct session types for the CURRENTLY VISIBLE week — what
 * `WeekHeader`'s per-day dot row renders. Fetches `GET /sessions?view=week`
 * once per visible week (keyed on that week's Monday), separately from the
 * pager's own per-VISIBLE-DAY fetches (`day-timeline.tsx`'s
 * `listSessions("day", date)`) — some request duplication is simpler than
 * plumbing this through the pager, and the payloads only overlap, they don't
 * conflict.
 *
 * `visibleDate` tracks the finger during a swipe (see `WeekScreen`), but the
 * effect only re-fires when it crosses into a new week — `anchorKey` is the
 * dependency, `visibleDateRef` supplies the actual date at fetch time so a
 * within-week day change (or mid-swipe finger position) doesn't refetch.
 * Also refetches on `focusTick` — the same screen-focus / create-edit-teleport
 * bump `WeekScreen` already uses to make every mounted day revalidate — so a
 * task created or moved elsewhere updates the dots too.
 */


/** The week's dots from saved days / months (offline, or before the fetch lands). */
function savedWeekTypes(monday: Date, tz: string): DayTypes {
  const sessions = new Map<string, Session>();
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    const saved =
      getCachedDaySessions(dateKey(day)) ?? getCachedMonthSessions(day) ?? [];
    for (const s of saved) sessions.set(s.id, s);
  }
  const week = new Set(
    Array.from({ length: 7 }, (_, i) => dateKey(addDays(monday, i))),
  );
  const all = dayBarsByDay(Array.from(sessions.values()), tz);
  for (const k of Array.from(all.keys())) if (!week.has(k)) all.delete(k);
  return all;
}

export function useWeekDayTypes(
  visibleDate: Date,
  tz: string,
  focusTick: number,
): DayTypes {
  const visibleDateRef = useRef(visibleDate);
  visibleDateRef.current = visibleDate;
  const anchorKey = dateKey(weekStart(visibleDate));
  const key = `${tz}|${anchorKey}`;
  // Keyed by week: landing on another week (a create/edit teleports the
  // calendar) must not show the previous week's map — it has none of the new
  // week's days, so the dot row went blank until the fetch returned. A cached
  // (or warmed, see `warmLandingDay`) week renders immediately.
  const [state, setState] = useState<{ key: string; map: DayTypes }>(() => ({
    key,
    map: getCachedWeekTypes(key) ?? savedWeekTypes(weekStart(visibleDate), tz),
  }));
  const dayTypes =
    state.key === key
      ? state.map
      : (getCachedWeekTypes(key) ?? savedWeekTypes(weekStart(visibleDate), tz));

  useEffect(() => {
    let cancelled = false;
    listSessions("week", weekStart(visibleDateRef.current))
      .then(({ sessions }) => {
        if (cancelled) return;
        const next = dayBarsByDay(sessions, tz);
        setCachedWeekTypes(key, next);
        // Refetches on every focus; keep the old Map when nothing changed so
        // `WeekHeader` doesn't re-render for an identical dot row.
        setState((prev) =>
          prev.key === key && sameDayBars(prev.map, next)
            ? prev
            : { key, map: next },
        );
      })
      .catch(() => {
        // Offline: draw the dots from the saved days instead of leaving them blank.
        if (cancelled) return;
        const saved = savedWeekTypes(weekStart(visibleDateRef.current), tz);
        setState((prev) =>
          prev.key === key && sameDayBars(prev.map, saved)
            ? prev
            : { key, map: saved },
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focusTick]);

  return dayTypes;
}

// Per-user, like the other stores: a different account must not see the
// previous one's dots.
useUserStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id) clearWeekTypesCache();
});
