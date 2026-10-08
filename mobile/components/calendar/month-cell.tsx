import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { AlertTriangle } from "@/components/Icons";
import {
  DragTargetProbe,
  SpotlightAnchor,
} from "@/components/checklist/spotlight-anchor";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
  isContinuationEntry,
  isOutsideMonth,
  MONTH_CELL_VISIBILITY_WEIGHTS,
  MONTH_PILL_CAP,
  monthPillCap,
  splitCellSessions,
} from "@/lib/month-date-math";
import { isSessionPastDeadline } from "@/lib/overdue";
import { SESSION_TYPE_META } from "@zenflow/core";
import {
  MONTH_PILL_CLASSES,
  MONTH_PILL_TEXT_CLASSES,
  deriveState,
} from "@/lib/task-card";
import { cn } from "@/lib/utils";
import type { Session } from "@zenflow/shared";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { sessionTypeIcon } from "./session-type-badge";

/** A week row's *preferred* height. Rows shrink below it (equally) when the
 * month doesn't fit between the header and the tab bar — small screens,
 * 6-week months — so the last week is never hidden under the bar. */
export const CELL_HEIGHT = 96;

/** Placeholder-pill widths while the month loads, picked per day so the
 * shimmer reads as varied task titles rather than one repeated bar (the
 * 44–80% spread is `mockups/month-view.html`'s Loading state). */
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
];

interface MonthCellProps {
  day: Date;
  monthDate: Date;
  sessions: Session[];
  isToday: boolean;
  /** Carry the checklist's "Open a day" spotlight anchor. */
  openDayTip: boolean;
  /** Carry the "Move a task to another day" demo's drop-target probe. */
  moveTargetTip: boolean;
  /** True while this cell is the current drag drop target. */
  isDropTarget: boolean;
  /** True for a beat right after a drag drop landed here. */
  isJustDropped: boolean;
  /** The month is still loading: the day number stays, the pills are
   * shimmering placeholders. */
  loading: boolean;
  /** The task id currently being dragged (any cell), so its origin pill can
   * hide in place while the ghost overlay stands in for it. */
  draggingSessionId: string | null;
  /** Receives the day's tasks too — a single tap opens the detail sheet in
   * place rather than navigating away. */
  onPressDay: (day: Date, tasks: Session[]) => void;
  /** A double tap on the cell jumps to the Week view with this day selected. */
  onDoubleTapDay: (day: Date) => void;
  onPressOverflow: (day: Date, tasks: Session[]) => void;
}

/** Max gap (ms) between two taps on a cell for the second to count as a
 * double tap → Week view. A single tap resolves after this delay. */
const DOUBLE_TAP_MS = 240;

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
  openDayTip,
  moveTargetTip,
  isDropTarget,
  isJustDropped,
  loading,
  draggingSessionId,
  onPressDay,
  onDoubleTapDay,
  onPressOverflow,
}: MonthCellProps) {
  useLanguage();
  const outside = isOutsideMonth(day, monthDate);

  // Single vs. double tap: a single tap opens the day sheet (deferred by
  // `DOUBLE_TAP_MS` so a second tap can cancel it); a double tap jumps to
  // Week view. `Pressable` has no native double-tap, so it's timed here.
  const lastTapRef = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    },
    [],
  );
  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      onDoubleTapDay(day);
      return;
    }
    lastTapRef.current = now;
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = setTimeout(() => {
      singleTapTimer.current = null;
      onPressDay(day, sessions);
    }, DOUBLE_TAP_MS);
  };

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
  // Measured height decides how many pills fit; the fixed cap is only the
  // first-frame fallback.
  const [cellHeight, setCellHeight] = useState<number | null>(null);
  const { visible, overflowCount } = splitCellSessions(
    bySeverity,
    cellHeight == null
      ? MONTH_PILL_CAP
      : monthPillCap(cellHeight, bySeverity.length),
  );
  // Pills that replace placeholders fade in; pills present from the start
  // (a cached month) just render.
  const hadSkeletonRef = useRef(loading);
  if (loading) hadSkeletonRef.current = true;
  const seed = day.getDate() + day.getDay();

  return (
    <Pressable
      onPress={handlePress}
      onLayout={(e) => setCellHeight(e.nativeEvent.layout.height)}
      style={{ width: `${100 / 7}%` }}
      className={cn(
        "overflow-hidden border-b border-r border-border p-[5px] pb-[6px]",
        outside ? "bg-muted/40" : "bg-transparent",
        isToday &&
          "border-t-2 border-t-orange-500 bg-orange-50 dark:bg-orange-950/20",
        (isDropTarget || isJustDropped) && "bg-primary/[0.14]",
      )}
    >
      {openDayTip ? <SpotlightAnchor step="open-day" /> : null}
      {moveTargetTip ? <DragTargetProbe /> : null}
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

      {loading ? (
        <View className={cn("mt-1 gap-[3px]", outside && "opacity-60")}>
          <Skeleton
            className={cn(
              "h-[15px] rounded-[5px]",
              SKELETON_PILL_WIDTHS[seed % SKELETON_PILL_WIDTHS.length],
            )}
          />
          {seed % 3 === 0 && (
            <Skeleton
              className={cn(
                "h-[15px] rounded-[5px]",
                SKELETON_PILL_WIDTHS[(seed + 4) % SKELETON_PILL_WIDTHS.length],
              )}
            />
          )}
        </View>
      ) : (
        <Animated.View
          entering={hadSkeletonRef.current ? FadeIn.duration(200) : undefined}
          className={cn("mt-1 gap-[3px]", outside && "opacity-60")}
        >
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
                +{overflowCount}
              </Text>
            </Pressable>
          )}
        </Animated.View>
      )}
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
  useLanguage();
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
