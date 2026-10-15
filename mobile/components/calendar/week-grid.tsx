import { listSessions, updateSession } from "@/api/tasks";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAfterPaint } from "@/hooks/use-after-paint";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { dayBarsByDay } from "@/lib/day-bar";
import { checkStateOf } from "@/lib/today-summary";
import { monthLabel } from "@/lib/month-date-math";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import {
  type DayGrid,
  buildDayGrid,
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
import { undoMove } from "@/lib/move-undo";
import { isPastDeadlineDrop } from "@/lib/overdue";
import {
  fetchDaySessions,
  getCachedDaySessions,
  isDayCacheFresh,
  notifySessionsMutated,
  sameSessions,
  subscribeToSessionMutations,
} from "@/lib/session-cache";
import {
  showDisplacedToast,
  showErrorToast,
  showSkippedToast,
} from "@/lib/task-toasts";
import {
  type GhostShift,
  blocksOnDay,
  dropOnDay,
  dropPreview,
} from "@/lib/anchor";
import {
  columnBlockFrame,
  weekColumnWidth,
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
import { DayBarView } from "./day-bar";
import { NowIndicator } from "./now-indicator";
import {
  type PendingSessionUpdate,
  type RecurringScopeChoice,
  type UpdateRecurringScope,
  moveUndoable,
} from "@/lib/recurring-scope";
import { rememberPlacement } from "@/lib/slot-alternatives";
import { SessionBlock } from "./task-block";
import { TIME_GUTTER_WIDTH, TimeGutter } from "./time-gutter";

/** Placeholder blocks (column, start minute, length) shown while a week loads. */
const SKELETON_BLOCKS = [
  { col: 0, top: 9 * 60, len: 90 },
  { col: 1, top: 13 * 60, len: 120 },
  { col: 2, top: 8 * 60, len: 60 },
  { col: 2, top: 15 * 60, len: 90 },
  { col: 3, top: 10 * 60, len: 120 },
  { col: 4, top: 14 * 60, len: 60 },
  { col: 5, top: 9 * 60, len: 90 },
  { col: 6, top: 16 * 60, len: 60 },
] as const;

/** Start-of-day anchor for a week with nothing to scroll to. */
const DEFAULT_ANCHOR_MIN = 8 * 60;

export type WeekScopeRequest = (
  session: Session,
  pending: PendingSessionUpdate,
  onResolve: (choice: RecurringScopeChoice) => void,
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
 * to move it in time or to another day of the week; the same confirmations as
 * Day view apply. Hour height and night folds come from `lib/day-grid.ts`.
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
    <View className="flex-1">
      <View className="px-4 pb-1 pt-2.5">
        <Text className="text-xl font-bold tracking-tight">
          {monthLabel(anchor)}
        </Text>
        <Text className="mt-px text-sm font-medium text-muted-foreground">
          {t("{start} to {end}", {
            start: format(weekDays(anchor)[0], "MMM d"),
            end: format(weekDays(anchor)[6], "MMM d"),
          })}
        </Text>
      </View>
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
          />
        </View>
      ))}
    </ScrollView>
    </View>
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
}: WeekPageProps) {
  const { toast, confirm } = useToast();
  const tabBarOverlay = useTabBarOverlayHeight();
  const hourHeight = useHourHeight();
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weekKey = dateKey(days[0]);
  const columnWidth = weekColumnWidth(width, TIME_GUTTER_WIDTH);

  const cacheKey = `week:${weekKey}`;
  const [sessions, setSessions] = useState<Session[] | null>(
    () => getCachedDaySessions(cacheKey) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [mutationTick, setMutationTick] = useState(0);
  const [settleKey, setSettleKey] = useState(0);
  // The block being dragged and the slot it currently previews (null when idle).
  const [dragging, setDragging] = useState<{
    taskId: string;
    startMin: number;
    dayShift: number;
  } | null>(null);
  const handleDragState = useCallback(
    (snap: { startMin: number; taskId?: string; dayShift?: number } | null) =>
      setDragging(
        snap?.taskId
          ? {
              taskId: snap.taskId,
              startMin: snap.startMin,
              dayShift: snap.dayShift ?? 0,
            }
          : null,
      ),
    [],
  );
  const scrolledRef = useRef(false);
  const scrollViewRef = useRef<ScrollViewInstance>(null);

  useEffect(
    () => subscribeToSessionMutations(() => setMutationTick((n) => n + 1)),
    [],
  );

  useEffect(() => {
    let alive = true;
    const apply = (next: Session[]) =>
      setSessions((prev) =>
        prev != null && sameSessions(prev, next) ? prev : next,
      );
    if (isDayCacheFresh(cacheKey)) {
      const cached = getCachedDaySessions(cacheKey);
      if (cached) apply(cached);
      return;
    }
    fetchDaySessions(cacheKey, async () => {
      const res = await listSessions("week", days[0]);
      return res.sessions;
    })
      .then((next) => {
        if (!alive) return;
        apply(next);
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

  // A new week paints its columns first; blocks follow once it has painted,
  // behind a skeleton held briefly so they never pop in.
  const painted = useAfterPaint();
  const loading = useDelayedLoading((!painted || sessions === null) && !failed);
  const shown = loading ? null : sessions;
  const barsByDay = useMemo(
    () => dayBarsByDay(shown ?? [], tz),
    [shown, tz],
  );

  const sessionsById = useMemo(
    () => new Map((shown ?? []).map((s) => [s.id, s])),
    [shown],
  );

  const checkStateById = useMemo(
    () => new Map((shown ?? []).map((s) => [s.id, checkStateOf(s)] as const)),
    [shown],
  );

  const segmentsByDay = useMemo<DaySegment[][]>(() => {
    const blocks = tasksToBlocks(shown ?? []);
    return days.map((day) => eventsForDay(blocks, day, tz));
  }, [shown, days, tz]);

  const grid: DayGrid = useMemo(() => buildDayGrid(hourHeight), [hourHeight]);
  const layouts = useMemo(
    () => segmentsByDay.map((segments) => getOverlapLayout(segments)),
    [segmentsByDay],
  );

  // Ghosts for the dragged block's day: the blocks its drop would push, at the
  // slot it previews. A blocked drop shows none; it bounces back on release.
  const dragGhosts = useMemo<{
    dayIndex: number;
    fromIndex: number;
    ghosts: GhostShift[];
  } | null>(() => {
    if (!dragging) return null;
    const dragged = sessionsById.get(dragging.taskId);
    if (!dragged?.scheduledStartTime) return null;
    const fromKey = dateKey(zonedDate(dragged.scheduledStartTime, tz));
    const fromIndex = days.findIndex((d) => dateKey(d) === fromKey);
    const dayIndex = fromIndex + dragging.dayShift;
    if (fromIndex < 0 || dayIndex < 0 || dayIndex > 6) return null;
    const dayKeyStr = dateKey(days[dayIndex]);
    const preview = dropPreview(
      { id: dragged.id, durationMin: dragged.durationMinutes },
      dragging.startMin,
      blocksOnDay(shown ?? [], dayKeyStr, tz),
    );
    return { dayIndex, ghosts: preview.ghosts, fromIndex };
  }, [dragging, sessionsById, shown, days, tz]);

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
          showDisplacedToast(toast, updated.displacedSessions);
          rememberPlacement(updated);
          // Show the new time at once; the refetch re-derives the neighbours.
          setSessions((prev) =>
            prev?.map((x) => (x.id === taskId ? { ...x, ...updated } : x)) ?? prev,
          );
          showMovedToast(toast, {
            to: zonedDate(updated.scheduledStartTime ?? startISO, tz),
            withTime: true,
            onUndo: moveUndoable(session, scope)
              ? () =>
                  void undoMove(updated, session, scope, skipConflicting)
                    .then(() => notifySessionsMutated())
                    .catch((error) =>
                      showErrorToast(
                        toast,
                        error,
                        t("Couldn't move this session"),
                        "calendar-x",
                      ),
                    )
              : undefined,
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

      // A drop onto a pinned or fixed session (or one that would push a pinned
      // session out of the way) bounces back: nothing is sent.
      const preview = dropOnDay(session, startISO, [...sessionsById.values()], tz);
      if (preview.blocked) {
        toast({
          title: t("Can't move here"),
          description: t("A pinned or fixed session is in the way."),
          variant: "warning",
          icon: "calendar-x",
        });
        setSettleKey((k) => k + 1);
        return;
      }

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
        confirm(t("Past the deadline?"), {
          description: t("This session will start past its due time."),
          confirmLabel: t("Keep late"),
          cancelLabel: t("Snap back"),
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
              <View className="w-full px-1.5 pt-0.5">
                <DayBarView
                  bar={barsByDay.get(dateKey(day))}
                  testID={`week-bar.${dateKey(day)}`}
                />
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

          {loading ? (
            <View
              testID="week-grid.skeleton"
              pointerEvents="none"
              className="absolute bottom-0 top-0"
              style={{ left: columnsLeft, right: 0 }}
            >
              {SKELETON_BLOCKS.map((b) => (
                <View
                  key={`${b.col}-${b.top}`}
                  className="absolute"
                  style={{
                    left: b.col * columnWidth + 3,
                    width: columnWidth - 6,
                    top: minToY(grid, b.top),
                    height: minToY(grid, b.top + b.len) - minToY(grid, b.top),
                  }}
                >
                  <Skeleton className="size-full rounded-lg" />
                </View>
              ))}
            </View>
          ) : null}

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
                  zIndex: dragGhosts?.fromIndex === dayIndex ? 20 : 0,
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
                      anchor={sessionsById.get(segment.taskId)?.anchor}
                      onDragStateChange={handleDragState}
                      onReschedule={handleReschedule}
                      settleKey={settleKey}
                      checkState={checkStateById.get(segment.taskId)}
                      showCheck={false}
                      dayWidth={columnWidth}
                      minDayShift={-dayIndex}
                      maxDayShift={6 - dayIndex}
                      onPress={onSessionPress}
                      onRequestReschedule={handleLongPress}
                      onLongPressMenu={
                        onRequestBlockMenu ? handleLongPressMenu : undefined
                      }
                      titleOnly
                    />
                  );
                })}
                {dragGhosts?.dayIndex === dayIndex &&
                  dragGhosts.ghosts.map((ghost) => {
                    const top = minToY(grid, ghost.toMin);
                    const bottom = minToY(grid, ghost.toMin + ghost.durationMin);
                    return (
                      <View
                        key={`ghost-${ghost.id}`}
                        testID={`drag-ghost.${ghost.id}`}
                        pointerEvents="none"
                        className="absolute overflow-hidden rounded-[14px] border-[1.5px] border-dashed border-muted-foreground/50 bg-muted/40 px-2 py-1"
                        style={{ left: 2, right: 2, top, height: Math.max(bottom - top, 16) }}
                      >
                        <Text numberOfLines={1} className="text-[11px] font-semibold text-muted-foreground">
                          {sessionsById.get(ghost.id)?.title ?? ""}
                        </Text>
                      </View>
                    );
                  })}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
