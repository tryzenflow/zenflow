import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { dateKey, isWeekendColumn } from "@/lib/month-date-math";
import { cn } from "@/lib/utils";
import type { Task } from "@zenflow/shared";
import { isSameDay } from "date-fns";
import { forwardRef } from "react";
import { FlatList, type LayoutChangeEvent, View } from "react-native";
import { CELL_HEIGHT, MonthCell } from "./month-cell";

// Monday-first — matches `WEEK_STARTS_ON` in `@/lib/month-date-math`.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface MonthGridProps {
  monthDate: Date;
  days: Date[];
  tz: string;
  today: Date;
  tasksByDate: Map<string, Task[]>;
  highlightedKey: string | null;
  draggingTaskId: string | null;
  onPressDay: (day: Date) => void;
  onPressOverflow: (day: Date, tasks: Task[]) => void;
  onPillDragStart: (task: Task, day: Date) => void;
  onPillDragUpdate: (absoluteX: number, absoluteY: number) => void;
  onPillDragEnd: (absoluteX: number, absoluteY: number) => void;
  onGridLayout: (event: LayoutChangeEvent) => void;
}

/**
 * 7-column Monday-first month grid (`FlatList`, `numColumns={7}`) — RN port
 * of `frontend/src/components/calendar/month-grid.tsx`. Not internally
 * scrollable (`scrollEnabled={false}`): a month page is always sized to its
 * own row count by the parent (`month-page.tsx`), and pagination between
 * months happens one level up via the outer horizontal pager, not by
 * scrolling this grid.
 */
export const MonthGrid = forwardRef<View, MonthGridProps>(function MonthGrid(
  {
    monthDate,
    days,
    tz,
    today,
    tasksByDate,
    highlightedKey,
    draggingTaskId,
    onPressDay,
    onPressOverflow,
    onPillDragStart,
    onPillDragUpdate,
    onPillDragEnd,
    onGridLayout,
  },
  ref,
) {
  return (
    <View className="flex-1 px-3 pb-3.5 pt-2">
      <View className="flex-row">
        {WEEKDAY_LABELS.map((label, i) => (
          <Text
            key={label}
            className={cn(
              "flex-1 py-2 text-center text-[10.5px] font-bold uppercase tracking-wider",
              isWeekendColumn(i)
                ? "text-muted-foreground/80"
                : "text-muted-foreground",
            )}
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
        <FlatList
          data={days}
          numColumns={7}
          scrollEnabled={false}
          keyExtractor={(day) => day.toISOString()}
          renderItem={({ item: day, index }) => {
            const key = dateKey(day);
            return (
              <MonthCell
                day={day}
                monthDate={monthDate}
                tz={tz}
                tasks={tasksByDate.get(key) ?? []}
                isToday={isSameDay(day, today)}
                isWeekend={isWeekendColumn(index % 7)}
                isDropTarget={highlightedKey === key}
                draggingTaskId={draggingTaskId}
                onPressDay={onPressDay}
                onPressOverflow={onPressOverflow}
                onPillDragStart={onPillDragStart}
                onPillDragUpdate={onPillDragUpdate}
                onPillDragEnd={onPillDragEnd}
              />
            );
          }}
        />
      </View>
    </View>
  );
});

/** Loading skeleton — same weekday header + fixed `CELL_HEIGHT` row geometry
 * as the loaded grid (5 rows, the most common month shape), so swapping to
 * real data never shifts layout (GitHub issue #21's checklist). */
export function MonthGridSkeleton() {
  const rows = 5;
  return (
    <View className="flex-1 px-3 pb-3.5 pt-2">
      <View className="flex-row">
        {WEEKDAY_LABELS.map((label) => (
          <Text
            key={label}
            className="flex-1 py-2 text-center text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground"
          >
            {label}
          </Text>
        ))}
      </View>
      <View className="overflow-hidden rounded-xl border border-border">
        {/* Static placeholder grid — never reordered/inserted/removed, so an
            index key is safe despite the usual React caveat. */}
        {Array.from({ length: rows }).map((_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton row, never reordered
          <View
            key={`skeleton-row-${row}`}
            className="flex-row border-b border-border"
          >
            {Array.from({ length: 7 }).map((_, col) => (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cell, never reordered
                key={`skeleton-cell-${row}-${col}`}
                style={{ height: CELL_HEIGHT }}
                className="flex-1 border-r border-border p-[5px]"
              >
                <Skeleton className="h-[18px] w-[18px] rounded-full" />
                <Skeleton className="mt-1.5 h-[10px] w-[80%] rounded" />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
