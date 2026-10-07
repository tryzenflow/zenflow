import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
import { useLastCreated } from "@/hooks/use-last-created";
import { dateKey, isOutsideMonth } from "@/lib/month-date-math";
import type { Session } from "@zenflow/shared";
import { isSameDay } from "date-fns";
import { forwardRef, memo, useMemo } from "react";
import { View, type ViewInstance } from "react-native";
import { CELL_HEIGHT, MonthCell } from "./month-cell";

// Monday-first — matches `WEEK_STARTS_ON` in `@/lib/month-date-math`.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Stable empty task list for days with nothing scheduled — a fresh `[]` per
 * cell each render would defeat `MonthCell`'s `React.memo`. */
const NO_TASKS: Session[] = [];

/** Splits the flat grid-day list into rows of 7. `getMonthGridDays` always
 * returns whole Monday-first weeks, so every chunk is exactly 7 long. */
function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

interface MonthGridProps {
  monthDate: Date;
  days: Date[];
  today: Date;
  tasksByDate: Map<string, Session[]>;
  highlightedKey: string | null;
  /** Day key to briefly pulse right after a drag drop lands on it. */
  justDroppedKey: string | null;
  /** Sessions are still loading — every cell shows placeholder pills. */
  loading: boolean;
  draggingSessionId: string | null;
  onPressDay: (day: Date, tasks: Session[]) => void;
  onDoubleTapDay: (day: Date) => void;
  onPressOverflow: (day: Date, tasks: Session[]) => void;
  onGridLayout: () => void;
}

/**
 * 7-column Monday-first month grid — RN port of
 * `frontend/src/components/calendar/month-grid.tsx`. Built from plain rows of
 * `View`s (see the comment at the row map): it never scrolls, since a month
 * page is always sized to its own row count by the parent
 * (`month-page.tsx`), and pagination between months happens one level up via
 * the outer horizontal pager, not by scrolling this grid.
 *
 * `React.memo`'d: an in-month pill drag pushes `highlightedKey` on `MonthPage`
 * once per crossed cell, re-rendering it — without this the whole 35–42-cell
 * grid re-rendered each time. Props are the memoised `days` / `tasksByDate` /
 * `today` from `MonthPage` plus primitives and stable callbacks.
 */
export const MonthGrid = memo(
  // RN 0.88: forward to `ViewInstance` (the `HostInstance`/`ReactNativeElement`
  // alias), not the `View` component-function type -- see day-timeline.tsx's
  // `scrollRef` comment.
  forwardRef<ViewInstance, MonthGridProps>(function MonthGrid(
    {
      monthDate,
      days,
      today,
      tasksByDate,
      highlightedKey,
      justDroppedKey,
      loading,
      draggingSessionId,
      onPressDay,
      onDoubleTapDay,
      onPressOverflow,
      onGridLayout,
    },
    ref,
  ) {
    // The cells the checklist's spotlights point at. "Open a day": today when
    // it's in this month, else mid-month. "Move a task": the day holding the
    // task the user just created, else the first day with one.
    const lastCreatedId = useLastCreated((s) => s.id);
    const { openDayKey, moveDayKey } = useMemo(() => {
      const inMonth = days.filter((d) => !isOutsideMonth(d, monthDate));
      const openDay =
        inMonth.find((d) => isSameDay(d, today)) ??
        new Date(monthDate.getFullYear(), monthDate.getMonth(), 15);
      let first: string | null = null;
      let created: string | null = null;
      for (const d of inMonth) {
        const key = dateKey(d);
        const list = tasksByDate.get(key);
        if (!list?.length) continue;
        first ??= key;
        if (lastCreatedId && list.some((t) => t.id === lastCreatedId)) {
          created = key;
          break;
        }
      }
      return {
        openDayKey: dateKey(openDay),
        moveDayKey: created ?? first ?? dateKey(openDay),
      };
    }, [days, monthDate, today, tasksByDate, lastCreatedId]);
    useLanguage();
    return (
      <View className="flex-1 px-3 pb-3.5 pt-2">
        <View className="flex-row">
          {WEEKDAY_LABELS.map((label) => (
            <Text
              key={t(label)}
              className="flex-1 py-2 text-center text-[10.5px] font-bold text-muted-foreground"
            >
              {t(label)}
            </Text>
          ))}
        </View>

        <View
          ref={ref}
          onLayout={onGridLayout}
          className="shrink overflow-hidden rounded-xl border-l border-t border-border"
        >
          {/* Plain rows of `View`s, NOT a `FlatList numColumns={7}`. This grid
              never scrolls (`MonthPage` sizes each page to its own row count)
              and always renders all 35–42 cells, so virtualization bought
              nothing — while nesting a `FlatList` inside `MonthPager`'s
              horizontal `FlatList` is a nested VirtualizedList, which RN warns
              about and which corrupts Android's view recycling when the screen
              is detached (switching tabs): "addViewAt: failed to insert view
              […] the specified child already has a parent". */}
          {chunkIntoWeeks(days).map((week) => (
            <View
              key={dateKey(week[0])}
              style={{ height: CELL_HEIGHT }}
              className="shrink flex-row"
            >
              {week.map((day) => {
                const key = dateKey(day);
                return (
                  <MonthCell
                    key={key}
                    day={day}
                    monthDate={monthDate}
                    sessions={tasksByDate.get(key) ?? NO_TASKS}
                    isToday={isSameDay(day, today)}
                    openDayTip={key === openDayKey}
                    moveDayTip={key === moveDayKey}
                    isDropTarget={highlightedKey === key}
                    isJustDropped={justDroppedKey === key}
                    loading={loading}
                    draggingSessionId={draggingSessionId}
                    onPressDay={onPressDay}
                    onDoubleTapDay={onDoubleTapDay}
                    onPressOverflow={onPressOverflow}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </View>
    );
  }),
);
