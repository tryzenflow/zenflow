import { useLanguage } from "@/hooks/use-language";
import { FONT_SCALE_CAP } from "@/lib/constants";
import { format, t } from "@/lib/i18n";
import { AlertTriangle } from "@/components/Icons";
import { SpotlightAnchor } from "@/components/checklist/spotlight-anchor";
import { Text } from "@/components/ui/text";
import {
  isContinuationEntry,
  isOutsideMonth,
  MONTH_CELL_VISIBILITY_WEIGHTS,
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
import { memo, useMemo } from "react";
import { Pressable, View } from "react-native";

/** A week row's *preferred* height. Rows shrink below it (equally) when the
 * month doesn't fit between the header and the tab bar — small screens,
 * 6-week months — so the last week is never hidden under the bar. */
export const CELL_HEIGHT = 104;

interface MonthCellProps {
  day: Date;
  monthDate: Date;
  sessions: Session[];
  isToday: boolean;
  /** Carry the checklist's "Open a day" spotlight anchor. */
  openDayTip: boolean;
  /** Carry the checklist's "Move a task to another day" spotlight anchor. */
  moveDayTip: boolean;
  /** True while this cell is the current drag drop target. */
  isDropTarget: boolean;
  /** True for a beat right after a drag drop landed here. */
  isJustDropped: boolean;
  /** The task id currently being dragged (any cell), so its origin pill can
   * hide in place while the ghost overlay stands in for it. */
  draggingSessionId: string | null;
  /** Receives the day's tasks too — a tap opens the detail sheet in place
   * rather than navigating away (the sheet's "Open day" goes to Week). */
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
  openDayTip,
  moveDayTip,
  isDropTarget,
  isJustDropped,
  draggingSessionId,
  onPressDay,
  onPressOverflow,
}: MonthCellProps) {
  useLanguage();
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
  // "Tuesday, Oct 7, 3 items": the cell reads as one control, its pills don't repeat.
  const count = sessions.length;
  const dayLabel = [
    format(day, "EEEE, MMM d"),
    isToday ? t("Today") : null,
    count === 0
      ? t("No items")
      : count === 1
        ? t("1 item")
        : t("{count} items", { count }),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      onPress={() => onPressDay(day, sessions)}
      style={{ width: `${100 / 7}%` }}
      accessibilityRole="button"
      accessibilityLabel={dayLabel}
      accessibilityHint={t("Opens this day's sessions")}
      className={cn(
        "overflow-hidden border-b border-r border-border p-[3px] pb-[6px]",
        outside ? "bg-muted/40" : "bg-transparent",
        isToday && "border-t-2 border-t-primary-text bg-primary/10",
        (isDropTarget || isJustDropped) && "bg-primary/[0.14]",
      )}
    >
      {openDayTip ? <SpotlightAnchor step="open-day" /> : null}
      {moveDayTip ? <SpotlightAnchor step="move-day" /> : null}
      <Text
        maxFontSizeMultiplier={FONT_SCALE_CAP.grid}
        className={cn(
          "ml-[2px] h-[23px] w-[23px] rounded-full text-center text-[12.5px] font-semibold leading-[23px]",
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
            hitSlop={{ top: 6, bottom: 8, left: 6, right: 6 }}
            accessibilityRole="link"
            accessibilityLabel={t("{count} more sessions, open the day", {
              count: overflowCount,
            })}
            className="rounded-[5px] px-1 py-0.5"
          >
            <Text
              maxFontSizeMultiplier={FONT_SCALE_CAP.grid}
              className="text-label font-bold leading-tight text-muted-foreground"
            >
              +{overflowCount} {t("more")}
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
  useLanguage();
  const state = deriveState(session);
  const late = isSessionPastDeadline(session);
  const continuation = isContinuationEntry(session);

  // No per-type glyph: at 11px a cell is ~50pt wide and the icon cost half the
  // title. The type reads from the pill's hue and outline (dashed for DND);
  // the day sheet shows the full badge. Only the states that need a symbol
  // keep one: past the deadline, or continuing from yesterday.
  return (
    <View
      style={hidden ? { opacity: 0 } : undefined}
      className={cn(
        "flex-row items-center gap-[3px] rounded-[5px] border px-1 py-0.5",
        late ? "border-warning/60 bg-warning/15" : MONTH_PILL_CLASSES[state],
        continuation &&
          "rounded-t-none border-t-[1.5px] border-t-muted-foreground/50 [border-top-style:dashed]",
      )}
    >
      {late ? (
        <AlertTriangle size={11} className="shrink-0 text-warning" />
      ) : continuation ? (
        <Text
          maxFontSizeMultiplier={FONT_SCALE_CAP.grid}
          className="shrink-0 text-label leading-none text-muted-foreground"
        >
          ↳
        </Text>
      ) : null}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={FONT_SCALE_CAP.grid}
        className={cn(
          "flex-1 text-label font-semibold leading-tight",
          late ? "text-warning" : MONTH_PILL_TEXT_CLASSES[state],
        )}
      >
        {session.title}
      </Text>
    </View>
  );
});
