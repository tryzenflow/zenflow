import { Text } from "@/components/ui/text";
import { isOutsideMonth, splitCellTasks } from "@/lib/month-date-math";
import {
  MONTH_PILL_CLASSES,
  MONTH_PILL_TEXT_CLASSES,
  deriveState,
} from "@/lib/task-card";
import { cn } from "@/lib/utils";
import { zonedDate } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

export const CELL_HEIGHT = 78;

interface MonthCellProps {
  day: Date;
  monthDate: Date;
  tz: string;
  tasks: Task[];
  isToday: boolean;
  isWeekend: boolean;
  /** True while this cell is the current drag drop target. */
  isDropTarget: boolean;
  /** The task id currently being dragged (any cell), so its origin pill can
   * hide in place while the ghost overlay stands in for it. */
  draggingTaskId: string | null;
  onPressDay: (day: Date) => void;
  onPressOverflow: (day: Date, tasks: Task[]) => void;
  onPillDragStart: (task: Task, day: Date) => void;
  onPillDragUpdate: (absoluteX: number, absoluteY: number) => void;
  onPillDragEnd: (absoluteX: number, absoluteY: number) => void;
}

/**
 * A single day cell in the Month grid — RN port of
 * `frontend/src/components/calendar/month-cell.tsx`. Leading/trailing days
 * from adjacent months ("outside") render dimmed, show no pills, and aren't
 * tappable/a drag target (GitHub issue #21's acceptance criteria).
 */
export function MonthCell({
  day,
  monthDate,
  tz,
  tasks,
  isToday,
  isWeekend,
  isDropTarget,
  draggingTaskId,
  onPressDay,
  onPressOverflow,
  onPillDragStart,
  onPillDragUpdate,
  onPillDragEnd,
}: MonthCellProps) {
  const outside = isOutsideMonth(day, monthDate);
  const { visible, overflowCount } = splitCellTasks(tasks);

  return (
    <Pressable
      disabled={outside}
      onPress={() => onPressDay(day)}
      style={{ width: `${100 / 7}%`, height: CELL_HEIGHT }}
      className={cn(
        "border-b border-r border-border p-[5px] pb-[3px]",
        outside ? "bg-muted/40" : isWeekend ? "bg-muted/45" : "bg-card",
        isToday && "border-t-2 border-t-primary",
        isDropTarget && "bg-primary/10",
      )}
    >
      <Text
        className={cn(
          "h-[22px] w-[22px] rounded-full text-center text-[12.5px] font-semibold leading-[22px]",
          outside
            ? "text-muted-foreground/50"
            : isToday
              ? "bg-primary text-primary-foreground"
              : "text-foreground",
        )}
      >
        {day.getDate()}
      </Text>

      {!outside && (
        <View className="mt-0.5 gap-0.5">
          {visible.map((task) => (
            <MonthPill
              key={task.id}
              task={task}
              day={day}
              tz={tz}
              hidden={draggingTaskId === task.id}
              onDragStart={onPillDragStart}
              onDragUpdate={onPillDragUpdate}
              onDragEnd={onPillDragEnd}
            />
          ))}
          {overflowCount > 0 && (
            <Pressable
              onPress={() => onPressOverflow(day, tasks)}
              hitSlop={6}
              className="px-0.5"
            >
              <Text className="text-[9.5px] font-bold leading-tight text-muted-foreground">
                +{overflowCount} more
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}

interface MonthPillProps {
  task: Task;
  day: Date;
  tz: string;
  hidden: boolean;
  onDragStart: (task: Task, day: Date) => void;
  onDragUpdate: (absoluteX: number, absoluteY: number) => void;
  onDragEnd: (absoluteX: number, absoluteY: number) => void;
}

/**
 * One task pill. Long-press-and-drag is a single `Pan` gesture configured
 * with `activateAfterLongPress` (react-native-gesture-handler's built-in
 * long-press-then-pan primitive — the RN equivalent of the issue's
 * "LongPressGestureHandler → PanGestureHandler" combo) instead of composing
 * two separate handlers. `.runOnJS(true)` runs every callback as a plain JS
 * function (not a UI-thread worklet) so it can call `expo-haptics` and the
 * parent's React-state setters directly — acceptable here since the grid is
 * small (≤42 cells) and the drag is a discrete, low-frequency gesture, not a
 * per-frame animation.
 */
function MonthPill({
  task,
  day,
  tz,
  hidden,
  onDragStart,
  onDragUpdate,
  onDragEnd,
}: MonthPillProps) {
  const state = deriveState(task);
  const label = task.scheduledStartTime
    ? `${format(zonedDate(task.scheduledStartTime, tz), "H:mm")} ${task.title}`
    : task.title;

  const pan = Gesture.Pan()
    .activateAfterLongPress(350)
    .runOnJS(true)
    .onStart(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      onDragStart(task, day);
    })
    .onUpdate((e) => {
      onDragUpdate(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      onDragEnd(e.absoluteX, e.absoluteY);
    });

  if (hidden) {
    // Keep the cell's layout stable while the dragged pill is "picked up" —
    // the ghost overlay (`month-page.tsx`) stands in for it during the drag.
    return <View style={{ height: 15 }} />;
  }

  return (
    <GestureDetector gesture={pan}>
      <View
        className={cn(
          "rounded-[5px] border-l-2 px-1.5 py-0.5",
          MONTH_PILL_CLASSES[state],
        )}
      >
        <Text
          numberOfLines={1}
          className={cn(
            "text-[9.5px] font-semibold leading-tight",
            MONTH_PILL_TEXT_CLASSES[state],
          )}
        >
          {label}
        </Text>
      </View>
    </GestureDetector>
  );
}
