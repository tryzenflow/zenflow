import { AlertTriangle } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { isOutsideMonth, splitCellSessions } from "@/lib/month-date-math";
import { isSessionPastDeadline } from "@/lib/overdue";
import { SESSION_TYPE_META } from "@/lib/session-type";
import {
  MONTH_PILL_CLASSES,
  MONTH_PILL_TEXT_CLASSES,
  deriveState,
} from "@/lib/task-card";
import { cn } from "@/lib/utils";
import type { Session } from "@zenflow/shared";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { sessionTypeIcon } from "./session-type-badge";

export const CELL_HEIGHT = 88;

interface MonthCellProps {
  day: Date;
  monthDate: Date;
  tasks: Session[];
  isToday: boolean;
  /** True while this cell is the current drag drop target. */
  isDropTarget: boolean;
  /** True for a beat right after a drag drop landed here. */
  isJustDropped: boolean;
  /** The task id currently being dragged (any cell), so its origin pill can
   * hide in place while the ghost overlay stands in for it. */
  draggingSessionId: string | null;
  /** Receives the day's tasks too — tapping a cell opens the detail sheet in
   * place rather than navigating to Day View. */
  onPressDay: (day: Date, tasks: Session[]) => void;
  onPressOverflow: (day: Date, tasks: Session[]) => void;
}

/**
 * A single day cell in the Month grid — RN port of
 * `frontend/src/components/calendar/month-cell.tsx`. Leading/trailing days
 * from adjacent months ("outside") render on a dimmed ground with their pills
 * at reduced opacity — they're still real days in view (a daily recurring
 * block, say, shouldn't visually stop dead at the month boundary), so they
 * stay tappable and are valid drop targets: dragging a session out of the day
 * sheet onto a trailing/leading cell reschedules it across the month boundary
 * (`month-page.tsx`).
 *
 * Pills themselves are not draggable in the grid — reschedule-by-drag is only
 * offered from the day/overflow sheet (`task-list-sheet.tsx`). The grid still
 * hides a pill whose session is mid-drag (`draggingSessionId`) so the floating
 * ghost stands in for it.
 *
 * `React.memo`'d so that when `MonthGrid` re-renders on a `highlightedKey`
 * change mid-drag, only the two cells whose `isDropTarget` actually flipped
 * re-render — not all 35–42. Relies on `MonthGrid` passing a stable empty
 * `tasks` array (`NO_TASKS`) and a memoised `today`.
 */
export const MonthCell = memo(function MonthCell({
  day,
  monthDate,
  tasks,
  isToday,
  isDropTarget,
  isJustDropped,
  draggingSessionId,
  onPressDay,
  onPressOverflow,
}: MonthCellProps) {
  const outside = isOutsideMonth(day, monthDate);
  const { visible, overflowCount } = splitCellSessions(tasks);

  return (
    <Pressable
      onPress={() => onPressDay(day, tasks)}
      style={{ width: `${100 / 7}%`, height: CELL_HEIGHT }}
      className={cn(
        "border-b border-r border-border p-[5px] pb-[6px]",
        outside ? "bg-muted/40" : "bg-transparent",
        isToday && "border-t-2 border-t-primary",
        (isDropTarget || isJustDropped) && "bg-primary/[0.14]",
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

      <View className={cn("mt-1 gap-[3px]", outside && "opacity-60")}>
        {visible.map((task) => (
          <MonthPill
            key={task.id}
            task={task}
            hidden={draggingSessionId === task.id}
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
    </Pressable>
  );
});

interface MonthPillProps {
  task: Session;
  /** True while this session is being dragged (from the day sheet) — the pill
   * hides in place so the floating ghost is the only copy on screen. */
  hidden: boolean;
}

/**
 * One task pill in a month cell — a plain, non-interactive chip. Rescheduling
 * by drag is offered only from the day/overflow sheet (`task-list-sheet.tsx`),
 * so the grid pill has no gesture of its own; tapping anywhere in the cell
 * opens that sheet. A session scheduled past its own deadline gets an amber
 * "late" treatment (`AlertTriangle`) — the same annotation the day/week block
 * carries. `React.memo`'d for the same reason as `MonthCell`: a mid-drag grid
 * re-render shouldn't re-render every pill.
 */
const MonthPill = memo(function MonthPill({ task, hidden }: MonthPillProps) {
  const state = deriveState(task);
  const late = isSessionPastDeadline(task);
  const Icon = sessionTypeIcon(task.type);

  return (
    <View
      style={hidden ? { opacity: 0 } : undefined}
      className={cn(
        "flex-row items-center gap-1 rounded-[5px] border-l-2 px-1.5 py-0.5",
        late
          ? "border-l-amber-500 bg-amber-500/15"
          : MONTH_PILL_CLASSES[state],
      )}
    >
      {late ? (
        <AlertTriangle
          size={9}
          className="shrink-0 text-amber-700 dark:text-amber-300"
        />
      ) : (
        <Icon
          size={9}
          className={cn("shrink-0", SESSION_TYPE_META[task.type].textClass)}
        />
      )}
      <Text
        numberOfLines={1}
        className={cn(
          "flex-1 text-[9.5px] font-semibold leading-tight",
          late
            ? "text-amber-700 dark:text-amber-300"
            : MONTH_PILL_TEXT_CLASSES[state],
        )}
      >
        {task.title}
      </Text>
    </View>
  );
});
