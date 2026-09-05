import { listSessions } from "@/api/tasks";
import { dateKey, weekStart } from "@/lib/week-date-math";
import { sessionTypesByDay } from "@/lib/week-day-types";
import type { SessionType } from "@zenflow/shared";
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
export function useWeekDayTypes(
  visibleDate: Date,
  tz: string,
  focusTick: number,
): Map<string, SessionType[]> {
  const [dayTypes, setDayTypes] = useState<Map<string, SessionType[]>>(
    () => new Map(),
  );
  const visibleDateRef = useRef(visibleDate);
  visibleDateRef.current = visibleDate;
  const anchorKey = dateKey(weekStart(visibleDate));

  useEffect(() => {
    let cancelled = false;
    listSessions("week", weekStart(visibleDateRef.current))
      .then(({ sessions }) => {
        if (cancelled) return;
        setDayTypes(sessionTypesByDay(sessions, tz));
      })
      .catch(() => {
        // Best-effort — the dot row just stays stale/empty, not worth a toast.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, tz, focusTick]);

  return dayTypes;
}
