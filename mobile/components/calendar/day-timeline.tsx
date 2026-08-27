import { listSessions, updateSession } from "@/api/tasks";
import {
  AlertCircle,
  AlertTriangle,
  RefreshCcw,
  RotateCw,
} from "@/components/Icons";
import { Portal } from "@/components/primitives/portal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useNow } from "@/hooks/use-now";
import { useUserStore } from "@/hooks/use-user-store";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { cn } from "@/lib/utils";
import { peekBlocksFromSegments, type PeekBlock } from "@/lib/peek";
import {
  DAILY_HORIZON,
  TIME_GRANULARITY,
  eventsForDay,
  getOverlapLayout,
  tasksToBlocks,
  zonedDate,
  zonedWallClockToUtc,
} from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { format, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import * as Haptics from "expo-haptics";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  clamp,
  withTiming,
  withSpring,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { NowIndicator } from "./now-indicator";
import { SessionBlock } from "./task-block";
import { TimeGutter } from "./time-gutter";

const GUTTER_WIDTH = 64;
const EMPTY_GHOST_MINUTES = 45;
const HOUR_HEIGHT_DEFAULT = 64;
const HOUR_HEIGHT_MIN = 48;
const HOUR_HEIGHT_MAX = 96;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const LOADING_PLACEHOLDERS = [
  { startMin: 8 * 60 + 15, duration: 60 },
  { startMin: 10 * 60, duration: 110 },
  { startMin: 12 * 60 + 30, duration: 90 },
  { startMin: 15 * 60, duration: 45 },
];

function scrollToNowOffset(totalHeight: number): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, (mins / DAILY_HORIZON) * totalHeight - 120);
}

/**
 * One shared card shape for the bottom-of-screen notifications this screen
 * shows (currently just the overdue warning) — a single visual language
 * instead of hand-rolling an icon-chip-plus-text layout per caller.
 * `subtitle` is optional.
 */
function BottomToastCard({
  icon,
  iconTint,
  title,
  subtitle,
}: {
  icon: ReactNode;
  iconTint: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View className="flex-row items-start gap-2.5 rounded-2xl border border-black/15 dark:border-white/15 bg-popover p-3.5 shadow-lg">
      <View
        className={cn(
          "h-[30px] w-[30px] items-center justify-center rounded-[9px]",
          iconTint,
        )}
      >
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold">{title}</Text>
        {!!subtitle && (
          <Text className="mt-0.5 text-[12.5px] text-muted-foreground">
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

export type TimelineState = "loading" | "error" | "ready";

interface DayTimelineProps {
  date?: Date;
  onSessionPress?: (taskId: string) => void;
  onLongPress?: (timeISO: string) => void;
  onComplete?: (taskId: string) => void;
  refreshKey?: number;
  onStateChange?: (state: TimelineState) => void;
  onReachBottom?: () => void;
  onOvernightTailsChange?: (tails: Session[]) => void;
  /** Hide the per-day header — the Week screen renders its own sticky
   * `WeekHeader` strip above the pager. Default `true` preserves the Day
   * screen. */
  showHeader?: boolean;
  /** Show the "Long press to add" ghost on empty non-today days too — the
   * Week pager surfaces it on any empty day. Default `false`. */
  showEmptyGhostAlways?: boolean;
  /** Fired while a session is dragged near the screen's left/right edge. */
  onDragEdge?: (edge: "left" | "right") => void;
  /** Fired while a session is dragged outside the edge zone (disarms a
   * pending cross-day advance). */
  onDragEdgeExit?: () => void;
  /** Fired when a session drag starts/stops (used to lock the pager). */
  onDragChange?: (dragging: boolean) => void;
  /** Fired after a session that was dragged onto another day is rescheduled. */
  onCrossDayReschedule?: (taskId: string, startISO: string) => void;
  /** Reports this day's sessions as mini-day blocks so a parent week pager
   * can render its next-day peek strip from real data. */
  onPeekChange?: (blocks: PeekBlock[], dayKey: string) => void;
}

export function DayTimeline({
  date: propDate,
  onSessionPress,
  onLongPress,
  onComplete,
  refreshKey,
  onStateChange,
  onReachBottom,
  onOvernightTailsChange,
  showHeader = true,
  showEmptyGhostAlways = false,
  onDragEdge,
  onDragEdgeExit,
  onDragChange,
  onCrossDayReschedule,
  onPeekChange,
}: DayTimelineProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const scrollRef = useRef<ScrollView>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const now = useNow();
  const tabBarOverlay = useTabBarOverlayHeight();

  // When it's today, the displayed day follows the live clock so the header
  // date auto-advances across midnight instead of freezing on yesterday.
  const date = useMemo(() => {
    if (!propDate) return toZonedTime(now, tz);
    const live = toZonedTime(now, tz);
    const sameDay =
      live.getFullYear() === propDate.getFullYear() &&
      live.getMonth() === propDate.getMonth() &&
      live.getDate() === propDate.getDate();
    return sameDay ? live : propDate;
  }, [propDate, now, tz]);
  const [hourHeight, setHourHeight] = useState(HOUR_HEIGHT_DEFAULT);
  const totalHeight = hourHeight * 24;
  const peekHeight = Math.round((screenHeight * 1) / 8);
  const contentWidth = screenWidth - GUTTER_WIDTH;

  const [tasks, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dragSnap, setDragSnap] = useState<{ startMin: number } | null>(null);

  const baseHourHeight = useSharedValue(HOUR_HEIGHT_DEFAULT);
  const ghostY = useSharedValue(0);
  const ghostVisible = useSharedValue(0);
  const dayKey = format(date, "yyyy-MM-dd");
  useEffect(() => {
    let cancelled = false;
    // Only show the full-screen loading skeleton when we have nothing to show.
    // Subsequent refetches (screen focus, implicit day-reschedule after a
    // create/edit, etc.) update `tasks` in place — the timeline stays
    // mounted so the past-night strip and other derived rendering don't
    // flicker off. The pull-to-refresh `RefreshControl` gives a separate
    // visual signal for user-initiated refreshes.
    if (tasks.length === 0) setLoading(true);
    setError(false);
    listSessions("day", date)
      .then((res) => {
        if (!cancelled) setSessions(res.sessions);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dayKey, refreshKey]);

  useEffect(() => {
    onStateChange?.(loading ? "loading" : error ? "error" : "ready");
  }, [loading, error, onStateChange]);

  const refetch = useCallback(async () => {
    try {
      const res = await listSessions("day", date);
      setSessions(res.sessions);
      setError(false);
    } catch {
      setError(true);
    }
  }, [date]);

  const overnightTails = useMemo(() => {
    const nextDay = startOfDay(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextMidnightMs = zonedWallClockToUtc(nextDay, tz).getTime();
    return tasks.filter((t) => {
      if (!t.scheduledStartTime) return false;
      const endMs =
        new Date(t.scheduledStartTime).getTime() + t.durationMinutes * 60_000;
      return endMs > nextMidnightMs;
    });
  }, [tasks, dayKey, tz]);

  const hasOvernightTails = overnightTails.length > 0;

  useEffect(() => {
    onOvernightTailsChange?.(overnightTails);
  }, [overnightTails, onOvernightTailsChange]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const handleComplete = useCallback(
    async (taskId: string) => {
      try {
        const updated = await updateSession(taskId, { status: "DONE" });
        setSessions((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)),
        );
        onComplete?.(taskId);
      } catch {
        // Swallow the error — the finally below reconciles from the server.
      } finally {
        // Completing frees the slot — reconcile so a neighbor's overlap-
        // derived conflict state (computed client-side, see `withOverlap`)
        // updates too.
        await refetch();
      }
    },
    [refetch, onComplete],
  );

  const segments = useMemo(() => {
    const blocks = tasksToBlocks(tasks);
    return eventsForDay(blocks, date, tz);
  }, [tasks, date, tz]);

  const layout = useMemo(() => getOverlapLayout(segments), [segments]);

  // Report this day's blocks so a parent Week pager can draw its next-day
  // peek strip from real data.
  const peekBlocks = useMemo(
    () => peekBlocksFromSegments(segments, date, tz),
    [segments, date, tz],
  );

  useEffect(() => {
    onPeekChange?.(peekBlocks, dayKey);
  }, [peekBlocks, dayKey, onPeekChange]);

  const deadlineBySession = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      if (t.deadline) map.set(t.id, t.deadline);
    }
    return map;
  }, [tasks]);

  const overdueCount = useMemo(() => {
    const seen = new Set<string>();
    for (const s of segments) {
      if (s.state === "overdue" && !seen.has(s.taskId)) seen.add(s.taskId);
    }
    return seen.size;
  }, [segments]);

  const overlapCount = useMemo(() => {
    const live = segments.filter((s) => s.status !== "DONE");
    let pairs = 0;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const aStart = new Date(live[i].start).getTime();
        const aEnd = new Date(live[i].end).getTime();
        const bStart = new Date(live[j].start).getTime();
        const bEnd = new Date(live[j].end).getTime();
        if (aStart < bEnd && bStart < aEnd) pairs++;
      }
    }
    return pairs;
  }, [segments]);

  const shownOverdueSession = useRef<string | null>(null);
  // Sessions already past their deadline on the first successful load are
  // ambient state — the header's "N overdue" badge is their surface. This
  // toast is only for a session that *becomes* overdue while the screen is
  // open (e.g. a save that lands past its deadline), so it doesn't nag on
  // every cold start.
  const overdueBaselined = useRef(false);
  const [overdueToast, setOverdueToast] = useState<{
    title: string;
    subtitle?: string;
  } | null>(null);

  useEffect(() => {
    if (loading || error) return;
    const overdue = segments.find((s) => s.state === "overdue");

    if (!overdueBaselined.current) {
      overdueBaselined.current = true;
      shownOverdueSession.current = overdue?.taskId ?? null;
      return;
    }

    if (!overdue) {
      shownOverdueSession.current = null;
      return;
    }
    if (shownOverdueSession.current === overdue.taskId) return;
    shownOverdueSession.current = overdue.taskId;

    // Kept deliberately short: a headline plus the task name. The earlier
    // version spelled out the deadline time, the fitted range and why it
    // didn't fit — too much to read for a transient toast.
    setOverdueToast({
      title: "Scheduled past deadline",
      subtitle: overdue.title,
    });
  }, [loading, error, segments]);

  useEffect(() => {
    if (!overdueToast) return;
    const timer = setTimeout(() => setOverdueToast(null), 8000);
    return () => clearTimeout(timer);
  }, [overdueToast]);

  const scrollToNow = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        y: scrollToNowOffset(totalHeight),
        animated: false,
      });
    }
  }, [totalHeight]);

  const handleTimelineLayout = useCallback(() => {
    if (loading) {
      const loadingOffset = ((8 * 60) / DAILY_HORIZON) * totalHeight - 120;
      scrollRef.current?.scrollTo({
        y: Math.max(0, loadingOffset),
        animated: false,
      });
      return;
    }
    if (error) return;
    scrollToNow();
  }, [loading, error, totalHeight, scrollToNow]);

  // Fires when the user scrolls into the invisible "past midnight" strip.
  // Position-based so it works regardless of platform velocity reporting.
  // Re-arms only after scrolling back up, so collapsing the slice doesn't
  // immediately flip back to it.
  const crossedBottomRef = useRef(false);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const maxY = Math.max(0, contentSize.height - layoutMeasurement.height);
      if (contentOffset.y >= maxY - 8 && !crossedBottomRef.current) {
        crossedBottomRef.current = true;
        onReachBottom?.();
      } else if (contentOffset.y < maxY - 60) {
        crossedBottomRef.current = false;
      }
    },
    [onReachBottom],
  );

  const isToday = useMemo(() => {
    const live = toZonedTime(now, tz);
    return (
      live.getFullYear() === date.getFullYear() &&
      live.getMonth() === date.getMonth() &&
      live.getDate() === date.getDate()
    );
  }, [date, now, tz]);

  const handleReschedule = useCallback(
    async (taskId: string, startISO: string) => {
      try {
        const updated = await updateSession(taskId, {
          scheduledStartTime: startISO,
        });
        // Patch the dragged task from the authoritative response so its new
        // time shows immediately; the refetch below re-derives every card's
        // overlap-based conflict state (client-side only, see `withOverlap`),
        // since neighbors' state can shift too.
        setSessions((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)),
        );
      } catch {
        // Swallow the error — the finally below reconciles from the server.
      } finally {
        await refetch();
      }
    },
    [date, refetch],
  );

  const handleDragStateChange = useCallback(
    (snap: { startMin: number } | null) => {
      setDragSnap(snap);
      onDragChange?.(snap !== null);
    },
    [onDragChange],
  );

  const formatSnapLabel = useCallback(
    (snap: { startMin: number } | null) => {
      if (!snap) return "";
      const wall = zonedDate(date, tz);
      wall.setHours(Math.floor(snap.startMin / 60), snap.startMin % 60, 0, 0);
      return wall.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
    },
    [date, tz],
  );

  const dragChipLabel = useMemo(
    () => formatSnapLabel(dragSnap),
    [formatSnapLabel, dragSnap],
  );

  const handleLongPress = useCallback(
    (y: number) => {
      const pxPerMin = totalHeight / DAILY_HORIZON;
      const minutes =
        Math.round(y / pxPerMin / TIME_GRANULARITY) * TIME_GRANULARITY;
      const clampedMin = Math.max(
        0,
        Math.min(DAILY_HORIZON - TIME_GRANULARITY, minutes),
      );

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const wall = zonedDate(date, tz);
      wall.setHours(Math.floor(clampedMin / 60), clampedMin % 60, 0, 0);
      const wallISO = zonedWallClockToUtc(wall, tz).toISOString();

      // Open create-task at the pressed time
      onLongPress?.(wallISO);
    },
    [date, tz, totalHeight],
  );

  const zoomGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const newHeight = clamp(
        baseHourHeight.value * e.scale,
        HOUR_HEIGHT_MIN,
        HOUR_HEIGHT_MAX,
      );
      baseHourHeight.value = newHeight;
    })
    .onEnd(() => {
      runOnJS(setHourHeight)(baseHourHeight.value);
    });

  const longPressGesture = Gesture.LongPress()
    .minDuration(500)
    .onBegin((e) => {
      const pxPerMin = totalHeight / DAILY_HORIZON;
      const minutes =
        Math.round(e.absoluteY / pxPerMin / TIME_GRANULARITY) *
        TIME_GRANULARITY;
      const clampedMin = Math.max(
        0,
        Math.min(DAILY_HORIZON - TIME_GRANULARITY, minutes),
      );
      ghostY.value = (clampedMin / DAILY_HORIZON) * totalHeight;
      ghostVisible.value = withTiming(1, { duration: 200 });
    })
    .onEnd((e) => {
      ghostVisible.value = withTiming(0, { duration: 150 });
      runOnJS(handleLongPress)(e.absoluteY);
    })
    .onFinalize(() => {
      ghostVisible.value = withTiming(0, { duration: 150 });
    });

  const contentGesture = Gesture.Simultaneous(zoomGesture, longPressGesture);

  const animatedContentStyle = useAnimatedStyle(() => ({
    height: baseHourHeight.value * 24 + (hasOvernightTails ? peekHeight : 0),
  }));

  const ghostStyle = useAnimatedStyle(() => ({
    top: ghostY.value,
    opacity: ghostVisible.value,
  }));

  const nowClock = toZonedTime(now, tz);
  const nowMinutes = nowClock.getHours() * 60 + nowClock.getMinutes();
  const nowLabel = `Now ${nowClock.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
  const emptyGhostTop =
    (Math.min(nowMinutes, DAILY_HORIZON - EMPTY_GHOST_MINUTES) /
      DAILY_HORIZON) *
    totalHeight;
  const emptyGhostHeight = (EMPTY_GHOST_MINUTES / DAILY_HORIZON) * totalHeight;

  return (
    <View className="flex-1 bg-background">
      {showHeader && (
        <View className="flex-row items-center justify-between px-4 pt-4 pb-4 border-b border-black/15 dark:border-white/15">
          <View className="min-w-0 flex-1">
            <Text className="text-xl font-bold tracking-tight">
              {format(date, "EEE, MMM d")}
            </Text>
            <Text className="mt-px text-xs font-medium text-muted-foreground">
              {loading
                ? "Loading your day…"
                : error
                  ? "Couldn't sync"
                  : dragSnap
                    ? "Moving · release to reschedule"
                    : overlapCount > 0
                      ? `${overlapCount} overlap${
                          overlapCount > 1 ? "s" : ""
                        } · ${tasks.length} tasks`
                      : tasks.length === 0
                        ? `${nowLabel} · nothing scheduled`
                        : `${nowLabel} · ${tasks.length} task${
                            tasks.length === 1 ? "" : "s"
                          } today`}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            {!loading && !error && overdueCount > 0 && (
              <View className="flex-row items-center gap-1 rounded-full border border-rose-400/50 bg-rose-100 px-2 py-0.5 dark:bg-rose-950">
                <AlertCircle
                  size={12}
                  className="text-rose-800 dark:text-rose-400"
                />
                <Text className="text-[11px] font-semibold leading-none text-rose-800 dark:text-rose-400">
                  {overdueCount} overdue
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        onLayout={handleTimelineLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerClassName={
          error ? "flex-1 items-center justify-center px-8" : undefined
        }
        contentContainerStyle={
          error
            ? undefined
            : // The Week pager (header hidden) applies its own bottom inset
              // around the pager; only pad here for the standalone Day screen.
              { paddingBottom: showHeader ? tabBarOverlay : 0 }
        }
      >
        {error ? (
          <>
            <View className="mb-3.5 size-[76px] items-center justify-center rounded-[22px] border border-destructive/35 bg-destructive/15">
              <AlertTriangle size={34} className="text-destructive" />
            </View>
            <Text className="text-center text-lg font-bold">
              Couldn't load your day
            </Text>
            <Text className="mt-1.5 max-w-[280px] text-center text-[13.5px] leading-normal text-muted-foreground">
              We couldn't reach the scheduler. Check your connection and try
              again.
            </Text>
            <Button
              variant="outline"
              className="mt-5 rounded-xl px-8 gap-2"
              onPress={() => void refetch()}
            >
              <RotateCw size={16} className="text-foreground" />
              <Text className="text-base font-semibold"> Try again</Text>
            </Button>
          </>
        ) : loading ? (
          <Animated.View style={animatedContentStyle} className="relative">
            <TimeGutter hourHeight={hourHeight} />

            <View
              className="absolute top-0 bottom-0 bg-card"
              style={{ left: GUTTER_WIDTH, right: 0 }}
            >
              {HOURS.map((hour) => (
                <View
                  key={hour}
                  className="absolute left-0 right-0 bg-border/50"
                  style={{
                    top: hour * hourHeight,
                    height: 1,
                  }}
                />
              ))}

              {LOADING_PLACEHOLDERS.map((p) => (
                <View
                  key={p.startMin}
                  className="absolute left-1.5 right-1.5"
                  style={{
                    top: (p.startMin / DAILY_HORIZON) * totalHeight,
                    height: (p.duration / DAILY_HORIZON) * totalHeight,
                  }}
                >
                  <Skeleton className="h-full w-full rounded-xl" />
                </View>
              ))}
            </View>
          </Animated.View>
        ) : (
          <GestureDetector gesture={contentGesture}>
            <Animated.View style={animatedContentStyle} className="relative">
              <TimeGutter hourHeight={hourHeight} />

              <View
                className="absolute top-0 bottom-0 bg-card"
                style={{ left: GUTTER_WIDTH, right: 0 }}
              >
                {/* Hour separator lines */}
                {HOURS.map((hour) => (
                  <View
                    key={hour}
                    className="absolute left-0 right-0 bg-border/50"
                    style={{
                      top: hour * hourHeight,
                      height: 1,
                    }}
                  />
                ))}

                {isToday && (
                  <NowIndicator now={now} tz={tz} totalHeight={totalHeight} />
                )}

                {segments.length === 0 && (isToday || showEmptyGhostAlways) && (
                  <View
                    pointerEvents="none"
                    className="absolute left-1.5 right-1.5 z-20 items-center justify-center rounded-xl border-[1.5px] border-dashed border-brand-orange/55 bg-brand-orange/[0.07]"
                    style={{ top: emptyGhostTop, height: emptyGhostHeight }}
                  >
                    <Text className="text-xs font-semibold text-brand-orange">
                      Long press to add
                    </Text>
                  </View>
                )}

                {segments.map((segment) => {
                  const blockLayout = layout.get(segment.segmentId) ?? {
                    column: 0,
                    columns: 1,
                    conflict: false,
                  };
                  const blockWidthPx = contentWidth / blockLayout.columns;
                  const leftOffsetPx = blockLayout.column * blockWidthPx;

                  return (
                    <SessionBlock
                      key={segment.segmentId}
                      segment={segment}
                      layout={blockLayout}
                      tz={tz}
                      totalHeight={totalHeight}
                      leftOffset={leftOffsetPx}
                      blockWidth={blockWidthPx}
                      deadline={deadlineBySession.get(segment.taskId) ?? null}
                      onReschedule={handleReschedule}
                      onDragStateChange={handleDragStateChange}
                      onPress={onSessionPress}
                      onComplete={handleComplete}
                      onDragEdge={onDragEdge}
                      onDragEdgeExit={onDragEdgeExit}
                      onCrossDayReschedule={onCrossDayReschedule}
                    />
                  );
                })}

                {/* Dashed midnight boundary — the day ends here and the empty
                  "past midnight" region begins below (only on days with a
                  crossing task). Rendered after the task blocks so the line
                  draws over the head block's flat bottom edge, mirroring
                  mockups/day-view.html's 12:00 AM. */}
                {hasOvernightTails && (
                  <View
                    pointerEvents="none"
                    className="absolute left-0 right-0 z-20 h-0 border-t border-dashed border-muted-foreground/55"
                    style={{ top: totalHeight }}
                  >
                    <View className="absolute right-2 -translate-y-1/2 rounded-md bg-background px-1.5 py-px">
                      <Text className="text-[10px] font-bold text-muted-foreground">
                        12:00 AM
                      </Text>
                    </View>
                  </View>
                )}

                {dragSnap && (
                  <View
                    pointerEvents="none"
                    className="absolute left-0 right-0 z-20"
                  >
                    {[-16, 0, 16, 32].map((offset) => {
                      const top =
                        (dragSnap.startMin / DAILY_HORIZON) * totalHeight +
                        offset;
                      return (
                        <View
                          key={offset}
                          className="absolute left-0 right-0 border-t border-dashed border-brand-orange/60"
                          style={{ top }}
                        >
                          {offset === 0 && (
                            <View className="absolute right-2 -translate-y-1/2 rounded-md bg-background px-[5px] py-px">
                              <Text className="text-[10px] font-bold text-brand-orange">
                                {dragChipLabel}
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                <Animated.View
                  pointerEvents="none"
                  style={ghostStyle}
                  className="absolute left-0 right-0 z-30 mx-1"
                >
                  <View className="h-[52px] items-center justify-center rounded-lg border border-dashed border-primary/50 bg-primary/5">
                    <Text className="text-xs font-medium text-primary/60">
                      + Add task
                    </Text>
                  </View>
                </Animated.View>
              </View>
            </Animated.View>
          </GestureDetector>
        )}
      </ScrollView>

      <Portal name="day-timeline-bottom-toast">
        <View
          pointerEvents="none"
          className="absolute left-4 right-4 z-[100] gap-2"
          style={{ bottom: tabBarOverlay + 8 }}
        >
          {overdueToast && (
            <BottomToastCard
              icon={
                <AlertCircle
                  size={17}
                  className="text-rose-600 dark:text-rose-400"
                />
              }
              iconTint="bg-rose-500/15"
              title={overdueToast.title}
              subtitle={overdueToast.subtitle}
            />
          )}
        </View>
      </Portal>
    </View>
  );
}
