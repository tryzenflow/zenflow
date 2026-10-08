import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
import { useLastCreated } from "@/hooks/use-last-created";
import { useSpotlight } from "@/hooks/use-spotlight";
import { dateKey, isOutsideMonth } from "@/lib/month-date-math";
import type { Session } from "@zenflow/shared";
import { isSameDay } from "date-fns";
import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
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
  /** Checklist "Move a task to another day": open the day that has a task so
   * its list (the only place a task can be dragged from) is on screen. */
  onOpenMoveDay?: (day: Date, tasks: Session[]) => void;
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
      onOpenMoveDay,
      onDoubleTapDay,
      onPressOverflow,
      onGridLayout,
    },
    ref,
  ) {
    // The days the checklist points at. "Open a day": today when it's in this
    // month, else mid-month (spotlighted cell). "Move a task": the day holding the
    // task the user just created, else the first day with one (its list opens).
    const lastCreatedId = useLastCreated((s) => s.id);
    const { openDayKey, moveDayKey, targetKey } = useMemo(() => {
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
      const moveKey = created ?? first ?? dateKey(openDay);
      // Where the demo finger drops: the earliest *future* day (top rows
      // first — the day sheet covers the lower grid), never the day being
      // dragged from. Falls back to any other day of the month when nothing
      // later is left (late in the month).
      const todayKey = dateKey(today);
      const target =
        inMonth.find((d) => dateKey(d) > todayKey && dateKey(d) !== moveKey) ??
        inMonth.find((d) => dateKey(d) !== moveKey);
      return {
        openDayKey: dateKey(openDay),
        moveDayKey: moveKey,
        targetKey: target ? dateKey(target) : null,
      };
    }, [days, monthDate, today, tasksByDate, lastCreatedId]);
    // Drag-to-another-day starts from a task row in the day's list, not from the
    // grid pill, so "show me" opens that list (once per request).
    const moveRequested = useSpotlight((s) => s.step === "move-day");
    const openedRef = useRef(false);
    useEffect(() => {
      if (!moveRequested) {
        openedRef.current = false;
        return;
      }
      if (openedRef.current || !onOpenMoveDay) return;
      const list = tasksByDate.get(moveDayKey);
      const day = days.find((d) => dateKey(d) === moveDayKey);
      if (!list?.length || !day) return;
      openedRef.current = true;
      onOpenMoveDay(day, list);
    }, [moveRequested, moveDayKey, tasksByDate, days, onOpenMoveDay]);
    useLanguage();
    // Rows share the grid's height equally, so the month always fits.
    const [gridHeight, setGridHeight] = useState(0);
    const weekRows = chunkIntoWeeks(days);
    const rowHeight =
      gridHeight > 0
        ? Math.max(CELL_HEIGHT / 2, (gridHeight - 2) / weekRows.length)
        : CELL_HEIGHT;
    return (
      <View className="flex-1 px-3 pt-2">
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
          onLayout={(e) => {
            setGridHeight(e.nativeEvent.layout.height);
            onGridLayout();
          }}
          className="flex-1 overflow-hidden rounded-xl border-l border-t border-border"
        >
          {/* Plain rows of `View`s, NOT a `FlatList numColumns={7}`. This grid
              never scrolls (`MonthPage` sizes each page to its own row count)
              and always renders all 35–42 cells, so virtualization bought
              nothing — while nesting a `FlatList` inside `MonthPager`'s
              horizontal `FlatList` is a nested VirtualizedList, which RN warns
              about and which corrupts Android's view recycling when the screen
              is detached (switching tabs): "addViewAt: failed to insert view
              […] the specified child already has a parent". */}
          {weekRows.map((week) => (
            <View
              key={dateKey(week[0])}
              style={{ height: rowHeight }}
              className="flex-row"
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
                    moveTargetTip={!!onOpenMoveDay && key === targetKey}
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
