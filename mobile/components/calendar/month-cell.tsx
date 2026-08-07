import { Text } from "@/components/ui/text";
import { isOutsideMonth, splitCellTasks } from "@/lib/month-date-math";
import {
  MONTH_PILL_CLASSES,
  MONTH_PILL_TEXT_CLASSES,
  deriveState,
} from "@/lib/task-card";
import { cn } from "@/lib/utils";
import type { Task } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

export const CELL_HEIGHT = 88;

interface MonthCellProps {
  day: Date;
  monthDate: Date;
  tasks: Task[];
  isToday: boolean;
  isWeekend: boolean;
  /** True while this cell is the current drag drop target. */
  isDropTarget: boolean;
  /** The task id currently being dragged (any cell), so its origin pill can
   * hide in place while the ghost overlay stands in for it. */
  draggingTaskId: string | null;
  /** Receives the day's tasks too — tapping a cell opens the detail sheet in
   * place rather than navigating to Day View. */
  onPressDay: (day: Date, tasks: Task[]) => void;
  onPressOverflow: (day: Date, tasks: Task[]) => void;
  onPillDragStart: (
    task: Task,
    day: Date,
    absoluteX: number,
    absoluteY: number,
  ) => void;
  onPillDragUpdate: (absoluteX: number, absoluteY: number) => void;
  onPillDragEnd: (absoluteX: number, absoluteY: number) => void;
  /** Fired when a drag is cancelled rather than completed. */
  onPillDragCancel: () => void;
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
  onPillDragCancel,
}: MonthCellProps) {
  const outside = isOutsideMonth(day, monthDate);
  const { visible, overflowCount } = splitCellTasks(tasks);

  return (
    <Pressable
      disabled={outside}
      onPress={() => onPressDay(day, tasks)}
      style={{ width: `${100 / 7}%`, height: CELL_HEIGHT }}
      className={cn(
        "border-b border-r border-border p-[5px] pb-[6px]",
        outside ? "bg-muted/40" : isWeekend ? "bg-muted/30" : "bg-transparent",
        isToday && "border-t-2 border-t-primary",
        isDropTarget && "bg-primary/[0.14]",
      )}
    >
      <Text
        className={cn(
          "h-[23px] w-[23px] rounded-full text-center text-[12.5px] font-semibold leading-[23px]",
          outside
            ? "text-muted-foreground opacity-60"
            : isToday
              ? "bg-primary text-primary-foreground"
              : "text-foreground",
        )}
      >
        {day.getDate()}
      </Text>

      {!outside && (
        <View className="gap-[3px]">
          {visible.map((task) => (
            <MonthPill
              key={task.id}
              task={task}
              day={day}
              hidden={draggingTaskId === task.id}
              onDragStart={onPillDragStart}
              onDragUpdate={onPillDragUpdate}
              onDragEnd={onPillDragEnd}
              onDragCancel={onPillDragCancel}
            />
          ))}
          {overflowCount > 0 && (
            <Pressable
              onPress={() => onPressOverflow(day, tasks)}
              hitSlop={6}
              className="rounded-[5px] px-1 py-0.5"
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
  hidden: boolean;
  onDragStart: (
    task: Task,
    day: Date,
    absoluteX: number,
    absoluteY: number,
  ) => void;
  onDragUpdate: (absoluteX: number, absoluteY: number) => void;
  onDragEnd: (absoluteX: number, absoluteY: number) => void;
  onDragCancel: () => void;
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
  hidden,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onDragCancel,
}: MonthPillProps) {
  const state = deriveState(task);

  // Every callback below is read out of a ref at fire time rather than
  // captured by the gesture's closure, so the `Gesture.Pan()` object itself
  // can be built exactly once (`useMemo`, no deps). It has to be: dragging
  // re-renders `MonthPage` on every finger frame (`ghostPos`), which
  // re-renders all ≤42 cells and every pill in them — rebuilding a gesture
  // config mid-gesture on each of those frames is exactly the case
  // react-native-gesture-handler warns about.
  const latest = useRef({
    task,
    day,
    onDragStart,
    onDragUpdate,
    onDragEnd,
    onDragCancel,
  });
  latest.current = {
    task,
    day,
    onDragStart,
    onDragUpdate,
    onDragEnd,
    onDragCancel,
  };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(350)
        .runOnJS(true)
        .onStart((e) => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
            () => {},
          );
          const c = latest.current;
          c.onDragStart(c.task, c.day, e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          latest.current.onDragUpdate(e.absoluteX, e.absoluteY);
        })
        .onEnd((e) => {
          latest.current.onDragEnd(e.absoluteX, e.absoluteY);
        })
        // `onEnd` fires only on a *successful* end. If the gesture is
        // cancelled — the outer pager claiming the touch, the pill unmounting
        // mid-drag — only `onFinalize` runs, so the parent's drag state must
        // be cleared here too or the pill stays hidden forever.
        .onFinalize((_e, success) => {
          if (!success) latest.current.onDragCancel();
        }),
    [],
  );

  return (
    <GestureDetector gesture={pan}>
      <View
        // `hidden` must NOT swap this subtree for a plain spacer `View`: the
        // pill is hidden by `onDragStart` — a callback of the very gesture
        // that is still running — so unmounting the `GestureDetector` here
        // tore down the live pan handler on its own first frame. No further
        // `onUpdate` ever arrived (the ghost froze at the pick-up point and
        // the finger could drag no further), and since the handler was gone
        // neither `onEnd` nor `onFinalize` fired, so `resetDragState` never
        // ran and the pager stayed frozen too. Staying mounted and merely
        // going transparent keeps the handler alive for the whole drag — and
        // preserves the cell's exact layout, which the old fixed-height
        // spacer only approximated.
        style={hidden ? { opacity: 0 } : undefined}
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
          {task.title}
        </Text>
      </View>
    </GestureDetector>
  );
}
