import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { dateKey } from "@/lib/month-date-math";
import { cn } from "@/lib/utils";
import type { Session } from "@zenflow/shared";
import { isSameDay } from "date-fns";
import { forwardRef, memo } from "react";
import { View } from "react-native";
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
  draggingSessionId: string | null;
  onPressDay: (day: Date, tasks: Session[]) => void;
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
  forwardRef<View, MonthGridProps>(function MonthGrid(
    {
      monthDate,
      days,
      today,
      tasksByDate,
      highlightedKey,
      justDroppedKey,
      draggingSessionId,
      onPressDay,
      onPressOverflow,
      onGridLayout,
    },
    ref,
  ) {
    return (
      <View className="flex-1 px-3 pb-3.5 pt-2">
        <View className="flex-row">
          {WEEKDAY_LABELS.map((label) => (
            <Text
              key={label}
              className="flex-1 py-2 text-center text-[10.5px] font-bold uppercase text-muted-foreground"
            >
              {label}
            </Text>
          ))}
        </View>

        <View
          ref={ref}
          onLayout={onGridLayout}
          className="overflow-hidden rounded-xl border-l border-t border-border"
        >
          {/* Plain rows of `View`s, NOT a `FlatList numColumns={7}`. This grid
              never scrolls (`MonthPage` sizes each page to its own row count)
              and always renders all 35–42 cells, so virtualization bought
              nothing — while nesting a `FlatList` inside `MonthPager`'s
              horizontal `FlatList` is a nested VirtualizedList, which RN warns
              about and which corrupts Android's view recycling when the screen
              is detached (switching tabs): "addViewAt: failed to insert view
              […] the specified child already has a parent". Same structure the
              skeleton below already used. */}
          {chunkIntoWeeks(days).map((week) => (
            <View key={dateKey(week[0])} className="flex-row">
              {week.map((day) => {
                const key = dateKey(day);
                return (
                  <MonthCell
                    key={key}
                    day={day}
                    monthDate={monthDate}
                    sessions={tasksByDate.get(key) ?? NO_TASKS}
                    isToday={isSameDay(day, today)}
                    isDropTarget={highlightedKey === key}
                    isJustDropped={justDroppedKey === key}
                    draggingSessionId={draggingSessionId}
                    onPressDay={onPressDay}
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

const SKELETON_ROWS = 4;

/** Per-cell placeholder-pill widths, cycled across the skeleton grid so the
 * shimmering rows read as varied task titles rather than one repeated bar —
 * the spread (44–80%) is lifted straight from `mockups/month-view.html`'s
 * Loading state. */
const SKELETON_PILL_WIDTHS = [
  "w-[62%]",
  "w-[48%]",
  "w-[70%]",
  "w-[55%]",
  "w-[78%]",
  "w-[44%]",
  "w-[66%]",
  "w-[52%]",
  "w-[74%]",
  "w-[58%]",
  "w-[80%]",
  "w-[50%]",
  "w-[68%]",
  "w-[46%]",
  "w-[72%]",
  "w-[60%]",
  "w-[76%]",
  "w-[54%]",
  "w-[64%]",
  "w-[56%]",
];

/** Loading skeleton — same weekday header + fixed `CELL_HEIGHT` row geometry
 * as the loaded grid (4 rows, matching the mockup's Loading state), so
 * swapping to real data never shifts layout (GitHub issue #21's checklist). */
export function MonthGridSkeleton() {
  return (
    <View className="flex-1 px-3 pb-3.5 pt-2">
      <View className="flex-row">
        {WEEKDAY_LABELS.map((label) => (
          <Text
            key={label}
            className="flex-1 py-2 text-center text-[10.5px] font-bold uppercase text-muted-foreground"
          >
            {label}
          </Text>
        ))}
      </View>
      <View className="overflow-hidden rounded-xl border-l border-t border-border">
        {/* Static placeholder grid — never reordered/inserted/removed, so an
            index key is safe despite the usual React caveat. */}
        {Array.from({ length: SKELETON_ROWS }).map((_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton row, never reordered
          <View key={`skeleton-row-${row}`} className="flex-row">
            {Array.from({ length: 7 }).map((_, col) => (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cell, never reordered
                key={`skeleton-cell-${row}-${col}`}
                style={{ height: CELL_HEIGHT }}
                className="flex-1 gap-[3px] overflow-hidden border-b border-r border-border p-[5px] pb-[3px]"
              >
                <Skeleton className="h-[14px] w-[18px] rounded" />
                <Skeleton
                  className={cn(
                    "h-[11px] rounded-[4px]",
                    SKELETON_PILL_WIDTHS[
                      (row * 7 + col) % SKELETON_PILL_WIDTHS.length
                    ],
                  )}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
