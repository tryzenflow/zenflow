import { AlertTriangle } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import {
  isContinuationEntry,
  isOutsideMonth,
  MONTH_CELL_VISIBILITY_WEIGHTS,
  splitCellSessions,
} from "@/lib/month-date-math";
import { isSessionPastDeadline } from "@/lib/overdue";
import { SESSION_TYPE_META } from "@/lib/session-type";
import {
  MONTH_PILL_CLASSES,
  MONTH_PILL_TEXT_CLASSES,
  deriveState,
} from "@/lib/task-card";
import { cn } from "@/lib/utils";
import type { Session } from "@zenflow/shared";
import { memo, useMemo } from "react";
import { Pressable, View } from "react-native";
import { sessionTypeIcon } from "./session-type-badge";

export const CELL_HEIGHT = 96;

interface MonthCellProps {
  day: Date;
  monthDate: Date;
  sessions: Session[];
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
  sessions,
  isToday,
  isDropTarget,
  isJustDropped,
  draggingSessionId,
  onPressDay,
  onPressOverflow,
}: MonthCellProps) {
  const outside = isOutsideMonth(day, monthDate);

  // `groupSessionsByDate` always hands us `sessions` in chronological order
  // (the day sheet relies on that), so re-sort a copy by type severity here —
  // this decides which `MONTH_PILL_CAP` sessions win the visible slots when a
  // day overflows, not the render order of the day sheet itself.
  const bySeverity = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          MONTH_CELL_VISIBILITY_WEIGHTS[b.type] -
          MONTH_CELL_VISIBILITY_WEIGHTS[a.type],
      ),
    [sessions],
  );
  const { visible, overflowCount } = splitCellSessions(bySeverity);

  return (
    <Pressable
      onPress={() => onPressDay(day, sessions)}
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
            session={task}
            hidden={draggingSessionId === task.id}
          />
        ))}
        {overflowCount > 0 && (
          <Pressable
            onPress={() => onPressOverflow(day, sessions)}
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
  session: Session;
  /** True while this session is being dragged (from the day sheet) — the pill
   * hides in place so the floating ghost is the only copy on screen. */
  hidden: boolean;
}

const MonthPill = memo(function MonthPill({ session, hidden }: MonthPillProps) {
  const state = deriveState(session);
  const late = isSessionPastDeadline(session);
  const Icon = sessionTypeIcon(session.type);
  const continuation = isContinuationEntry(session);

  return (
    <View
      style={hidden ? { opacity: 0 } : undefined}
      className={cn(
        "flex-row items-center gap-1 rounded-[5px] border-l-2 px-1.5 py-0.5",
        late ? "border-l-amber-500 bg-amber-500/15" : MONTH_PILL_CLASSES[state],
        continuation &&
          "rounded-t-none border-t-[1.5px] border-t-muted-foreground/50 [border-top-style:dashed]",
      )}
    >
      {late ? (
        <AlertTriangle
          size={9}
          className="shrink-0 text-amber-700 dark:text-amber-300"
        />
      ) : continuation ? (
        <Text className="shrink-0 text-[9px] leading-none text-muted-foreground">
          ↳
        </Text>
      ) : (
        <Icon
          size={9}
          className={cn("shrink-0", SESSION_TYPE_META[session.type].textClass)}
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
        {session.title}
      </Text>
    </View>
  );
});
