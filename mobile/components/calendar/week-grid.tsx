import { listSessions, updateSession } from "@/api/tasks";
import { useToast } from "@/components/ui/toast";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import {
  type DayGrid,
  type FoldId,
  FOLD_BAR_HEIGHT,
  buildDayGrid,
  foldedNightRanges,
  minToY,
  scrollAnchorMin,
  scrollYForMin,
  visibleHourMinutes,
} from "@/lib/day-grid";
import {
  getHourHeight,
  loadHourHeight,
  subscribeHourHeight,
} from "@/lib/hour-height";
import { format, formatTitle, t } from "@/lib/i18n";
import { showMovedToast } from "@/lib/move-toast";
import { isPastDeadlineDrop } from "@/lib/overdue";
import {
  notifySessionsMutated,
  subscribeToSessionMutations,
} from "@/lib/session-cache";
import { showErrorToast, showSkippedToast } from "@/lib/task-toasts";
import {
  columnBlockFrame,
  weekColumnWidth,
  weekSpans,
} from "@/lib/week-grid-math";
import { dateKey, shiftWeek, weekDays, weekStart } from "@/lib/week-date-math";
import {
  eventsForDay,
  getOverlapLayout,
  getSeriesKind,
  tasksToBlocks,
  zonedDate,
  zonedNow,
} from "@zenflow/core";
import type { DaySegment, Session } from "@zenflow/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  View,
  useWindowDimensions,
} from "react-native";
import { NowIndicator } from "./now-indicator";
import { type PendingSessionUpdate, type UpdateRecurringScope } from "./update-recurring-sheet";
import { SessionBlock } from "./task-block";
import { TIME_GUTTER_WIDTH, TimeGutter } from "./time-gutter";

/** Start-of-day anchor for a week with nothing to scroll to. */
const DEFAULT_ANCHOR_MIN = 8 * 60;

export type WeekSlotPick = (
  session: Session,
  primarySlot: string,
  alternativeSlot: string,
  slotProposalId: string,
  onPick: (chose: "primary" | "alternative") => Promise<void>,
) => void;

export type WeekScopeRequest = (
  session: Session,
  pending: PendingSessionUpdate,
  onResolve: (
    choice: { scope: UpdateRecurringScope; skipConflicting: boolean } | null,
  ) => void,
) => void;

export interface WeekGridProps {
  /** Any day of the week on screen. */
  anchor: Date;
  tz: string;
  /** Bumped by the parent on screen focus, so the visible week refetches. */
  focusTick: number;
  /** A swipe settled on another week: the parent moves its anchor there. */
  onWeekChange: (anchor: Date) => void;
  /** Tap a day header: the parent switches to Day view on that day. */
  onDayPress: (day: Date) => void;
  onSessionPress: (taskId: string) => void;
  onRequestReschedule?: (session: Session) => void;
  onRequestBlockMenu?: (session: Session) => void;
  onRequestScopedUpdate?: WeekScopeRequest;
  onRequestSlotPick?: WeekSlotPick;
}

function useHourHeight(): number {
  useEffect(() => {
    void loadHourHeight();
  }, []);
  return useSyncExternalStore(subscribeHourHeight, getHourHeight, getHourHeight);
}

/**
 * Week view of the calendar screen: seven day columns on a shared time grid.
 * Pages by week (three pages kept mounted, so a swipe slides one in), reuses
 * `TimeGutter` for the hour labels and `SessionBlock` (title-only) for the
 * blocks, laid out with the overlap helpers. Long-press a block and drag it
 * vertically to move it within its day; the same confirmations as Day view
 * apply. Hour height and night folds come from `lib/day-grid.ts`.
 */
export function WeekGrid({
  anchor,
  tz,
  focusTick,
  onWeekChange,
  onDayPress,
  onSessionPress,
  onRequestReschedule,
  onRequestBlockMenu,
  onRequestScopedUpdate,
  onRequestSlotPick,
}: WeekGridProps) {
  useLanguage();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const anchorKey = dateKey(weekStart(anchor));
  const pages = useMemo(
    () => [shiftWeek(anchor, -1), anchor, shiftWeek(anchor, 1)],
    // The anchor's week key decides the three pages; the exact day does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchorKey],
  );

  // Keep the middle (current) page on screen whenever the anchor moves.
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: width, animated: false });
  }, [anchorKey, width]);

  const onMomentumScrollEnd = (x: number) => {
    const index = Math.round(x / Math.max(1, width));
    if (index === 1) return;
    onWeekChange(pages[index]);
  };

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: width, y: 0 }}
      onMomentumScrollEnd={(e) =>
        onMomentumScrollEnd(e.nativeEvent.contentOffset.x)
      }
      className="flex-1"
    >
      {pages.map((pageAnchor, index) => (
        <View
          key={`${index}-${dateKey(weekStart(pageAnchor))}`}
          style={{ width }}
          className="flex-1"
        >
          <WeekPage
            anchor={pageAnchor}
            tz={tz}
            focusTick={focusTick}
            width={width}
            onDayPress={onDayPress}
            onSessionPress={onSessionPress}
            onRequestReschedule={onRequestReschedule}
            onRequestBlockMenu={onRequestBlockMenu}
            onRequestScopedUpdate={onRequestScopedUpdate}
            onRequestSlotPick={onRequestSlotPick}
          />
        </View>
      ))}
    </ScrollView>
  );
}

interface WeekPageProps {
  anchor: Date;
  tz: string;
  focusTick: number;
  width: number;
  onDayPress: (day: Date) => void;
  onSessionPress: (taskId: string) => void;
  onRequestReschedule?: (session: Session) => void;
  onRequestBlockMenu?: (session: Session) => void;
  onRequestScopedUpdate?: WeekScopeRequest;
  onRequestSlotPick?: WeekSlotPick;
}

function WeekPage({
  anchor,
  tz,
  focusTick,
  width,
  onDayPress,
  onSessionPress,
  onRequestReschedule,
  onRequestBlockMenu,
  onRequestScopedUpdate,
  onRequestSlotPick,
}: WeekPageProps) {
  const { toast, confirm } = useToast();
  const tabBarOverlay = useTabBarOverlayHeight();
  const hourHeight = useHourHeight();
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weekKey = dateKey(days[0]);
  const columnWidth = weekColumnWidth(width, TIME_GUTTER_WIDTH);

  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [mutationTick, setMutationTick] = useState(0);
  const [unfolded, setUnfolded] = useState<ReadonlySet<FoldId>>(new Set());
  const [settleKey, setSettleKey] = useState(0);
  const scrolledRef = useRef(false);
  const scrollViewRef = useRef<ScrollViewInstance>(null);

  useEffect(
    () => subscribeToSessionMutations(() => setMutationTick((n) => n + 1)),
    [],
  );

  useEffect(() => {
    let alive = true;
    listSessions("week", days[0])
      .then((res) => {
        if (!alive) return;
        setSessions(res.sessions);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
    // `days[0]` is the Monday of this week; the key captures it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey, focusTick, mutationTick]);

  const sessionsById = useMemo(
    () => new Map((sessions ?? []).map((s) => [s.id, s])),
    [sessions],
  );

  const segmentsByDay = useMemo<DaySegment[][]>(() => {
    const blocks = tasksToBlocks(sessions ?? []);
    return days.map((day) => eventsForDay(blocks, day, tz));
  }, [sessions, days, tz]);

  const folded = useMemo(
    () => foldedNightRanges(weekSpans(segmentsByDay, tz), unfolded),
    [segmentsByDay, tz, unfolded],
  );
  const grid: DayGrid = useMemo(
    () => buildDayGrid(hourHeight, folded),
    [hourHeight, folded],
  );
  const layouts = useMemo(
    () => segmentsByDay.map((segments) => getOverlapLayout(segments)),
    [segmentsByDay],
  );

  const now = zonedNow(tz);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayKey = dateKey(now);
  const containsToday = days.some((d) => dateKey(d) === todayKey);
  const firstEventMin = useMemo(() => {
    const starts = segmentsByDay.flat().map((s) => {
      const d = zonedDate(s.start, tz);
      return d.getHours() * 60 + d.getMinutes();
    });
    return starts.length ? Math.min(...starts) : null;
  }, [segmentsByDay, tz]);

  const handleContentSize = () => {
    if (scrolledRef.current) return;
    scrolledRef.current = true;
    const min = scrollAnchorMin({
      isToday: containsToday,
      nowMin,
      firstEventMin: firstEventMin ?? DEFAULT_ANCHOR_MIN,
    });
    scrollViewRef.current?.scrollTo({
      y: scrollYForMin(grid, min),
      animated: false,
    });
  };

  const handleReschedule = useCallback(
    (taskId: string, startISO: string) => {
      const session = sessionsById.get(taskId);
      if (!session) {
        setSettleKey((k) => k + 1);
        return;
      }
      const commit = async (
        scope?: UpdateRecurringScope,
        skipConflicting?: boolean,
      ) => {
        try {
          const updated = await updateSession(taskId, {
            scheduledStartTime: startISO,
            scope,
            skipConflicting,
          });
          showSkippedToast(toast, updated.skippedSessionIds);
          if (
            updated.divergent &&
            updated.slotProposalId &&
            updated.primarySlot &&
            updated.alternativeSlot &&
            onRequestSlotPick
          ) {
            // The slot picker's confirm runs the pick; this only refetches.
            onRequestSlotPick(
              session,
              updated.primarySlot,
              updated.alternativeSlot,
              updated.slotProposalId,
              async () => notifySessionsMutated(),
            );
            return;
          }
          showMovedToast(toast, {
            to: zonedDate(updated.scheduledStartTime ?? startISO, tz),
            withTime: true,
          });
        } catch (error) {
          showErrorToast(
            toast,
            error,
            t("Couldn't move this session"),
            "calendar-x",
          );
        } finally {
          notifySessionsMutated();
          setSettleKey((k) => k + 1);
        }
      };

      const seriesKind = getSeriesKind(session);
      const needsScope = seriesKind === "recurring" || seriesKind === "task";
      const run = () => {
        if (needsScope && onRequestScopedUpdate) {
          onRequestScopedUpdate(
            session,
            {
              scheduledStartTime: startISO,
              durationMinutes: session.durationMinutes,
            },
            (choice) => {
              if (!choice) {
                setSettleKey((k) => k + 1);
                return;
              }
              void commit(choice.scope, choice.skipConflicting);
            },
          );
          return;
        }
        void commit();
      };

      if (isPastDeadlineDrop(startISO, session.deadline ?? null)) {
        confirm(t("Schedule after the deadline?"), {
          description: t("This session will start past its due time."),
          confirmLabel: t("Schedule anyway"),
          cancelLabel: t("Cancel"),
          onConfirm: run,
          onCancel: () => setSettleKey((k) => k + 1),
        });
        return;
      }
      run();
    },
    [
      sessionsById,
      toast,
      confirm,
      tz,
      onRequestScopedUpdate,
      onRequestSlotPick,
    ],
  );

  const handleLongPress = useCallback(
    (taskId: string) => {
      const session = sessionsById.get(taskId);
      if (session) onRequestReschedule?.(session);
    },
    [sessionsById, onRequestReschedule],
  );
  const handleLongPressMenu = useCallback(
    (taskId: string) => {
      const session = sessionsById.get(taskId);
      if (session) onRequestBlockMenu?.(session);
    },
    [sessionsById, onRequestBlockMenu],
  );

  const contentHeight = grid.height + tabBarOverlay + 16;
  const columnsLeft = TIME_GUTTER_WIDTH;

  return (
    <View className="flex-1">
      <Text className="px-4 pb-1 pt-1 text-[11.5px] font-medium text-muted-foreground">
        {t("{start} to {end}", {
          start: format(days[0], "MMM d"),
          end: format(days[6], "MMM d"),
        })}
      </Text>
      <View className="flex-row border-b border-border bg-background">
        <View style={{ width: TIME_GUTTER_WIDTH }} />
        {days.map((day) => {
          const isToday = dateKey(day) === todayKey;
          return (
            <Pressable
              key={dateKey(day)}
              onPress={() => onDayPress(day)}
              accessibilityRole="button"
              accessibilityLabel={formatTitle(day, "EEEE, MMMM d")}
              className="flex-1 items-center gap-0.5 py-1.5 active:opacity-70"
              style={{ width: columnWidth }}
            >
              <Text className="text-[11px] font-semibold text-muted-foreground">
                {format(day, "EEE")}
              </Text>
              <View
                className={
                  isToday
                    ? "size-7 items-center justify-center rounded-full bg-primary"
                    : "size-7 items-center justify-center rounded-full"
                }
              >
                <Text
                  className={
                    isToday
                      ? "text-[14px] font-bold text-primary-foreground"
                      : "text-[14px] font-semibold text-foreground"
                  }
                >
                  {format(day, "d")}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {failed && sessions === null ? (
        <Text className="px-4 py-3 text-[13px] text-muted-foreground">
          {t("Couldn't load this week")}
        </Text>
      ) : null}

      <ScrollView
        ref={scrollViewRef}
        onContentSizeChange={handleContentSize}
        contentContainerStyle={{ height: contentHeight }}
        className="flex-1"
      >
        <View style={{ height: grid.height }}>
          <TimeGutter grid={grid} />

          {visibleHourMinutes(grid).map((min) => (
            <View
              key={`line-${min}`}
              pointerEvents="none"
              className="absolute border-t border-border/60"
              style={{
                left: columnsLeft,
                right: 0,
                top: minToY(grid, min),
              }}
            />
          ))}

          {days.map((day, dayIndex) => {
            const segments = segmentsByDay[dayIndex];
            const layout = layouts[dayIndex];
            const isToday = dateKey(day) === todayKey;
            return (
              <View
                key={dateKey(day)}
                className="absolute bottom-0 top-0 border-l border-border"
                style={{
                  left: columnsLeft + dayIndex * columnWidth,
                  width: columnWidth,
                }}
              >
                {isToday ? <NowIndicator top={minToY(grid, nowMin)} /> : null}
                {segments.map((segment) => {
                  const blockLayout = layout.get(segment.segmentId) ?? {
                    column: 0,
                    columns: 1,
                    conflict: false,
                  };
                  const frame = columnBlockFrame(blockLayout, columnWidth);
                  return (
                    <SessionBlock
                      key={segment.segmentId}
                      segment={segment}
                      layout={blockLayout}
                      tz={tz}
                      grid={grid}
                      leftOffset={frame.left}
                      blockWidth={frame.width}
                      deadline={sessionsById.get(segment.taskId)?.deadline ?? null}
                      late={sessionsById.get(segment.taskId)?.late ?? false}
                      onReschedule={handleReschedule}
                      settleKey={settleKey}
                      onPress={onSessionPress}
                      onRequestReschedule={handleLongPress}
                      onLongPressMenu={
                        onRequestBlockMenu ? handleLongPressMenu : undefined
                      }
                      titleOnly
                    />
                  );
                })}
              </View>
            );
          })}

          {grid.bands
            .filter((band) => band.folded && band.id)
            .map((band) => (
              <Pressable
                key={band.id}
                onPress={() =>
                  setUnfolded((cur) => new Set(cur).add(band.id as FoldId))
                }
                accessibilityRole="button"
                accessibilityLabel={t("Show night hours")}
                className="absolute items-center justify-center bg-muted/40 active:bg-muted"
                style={{
                  left: 0,
                  right: 0,
                  top: band.top,
                  height: FOLD_BAR_HEIGHT,
                }}
              >
                <Text className="text-[11px] font-medium text-muted-foreground">
                  {t("Show night hours")}
                </Text>
              </Pressable>
            ))}
        </View>
      </ScrollView>
    </View>
  );
}
