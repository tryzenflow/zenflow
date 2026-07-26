import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { View, ScrollView, RefreshControl, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DAILY_HORIZON,
  TIME_GRANULARITY,
  DEFAULT_WORK_PREFS,
  eventsForDay,
  tasksToBlocks,
  getOverlapLayout,
  zonedNow,
  zonedWallClockToUtc,
  zonedDate,
} from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { useUserStore } from "@/hooks/use-user-store";
import { listTasks, rescheduleTask, completeTask } from "@/api/tasks";
import { TimeGutter } from "./time-gutter";
import { WorkZoneOverlay } from "./work-zone-overlay";
import { NowIndicator } from "./now-indicator";
import { TaskBlock } from "./task-block";
import { format } from "date-fns";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  clamp,
  withTiming,
  withSpring,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const GUTTER_WIDTH = 64;
const HOUR_HEIGHT_DEFAULT = 64;
const HOUR_HEIGHT_MIN = 48;
const HOUR_HEIGHT_MAX = 96;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function scrollToNowOffset(totalHeight: number): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, (mins / DAILY_HORIZON) * totalHeight - 120);
}

interface DayTimelineProps {
  date?: Date;
  onTaskPress?: (taskId: string) => void;
  onLongPress?: (timeISO: string) => void;
  onComplete?: (taskId: string) => void;
  refreshKey?: number;
}

export function DayTimeline({ date: propDate, onTaskPress, onLongPress, onComplete, refreshKey }: DayTimelineProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const prefs = useUserStore((s) => s.user) ?? DEFAULT_WORK_PREFS;
  const scrollRef = useRef<ScrollView>(null);
  const { width: screenWidth } = useWindowDimensions();

  const date = propDate ?? zonedNow(tz);
  const [hourHeight, setHourHeight] = useState(HOUR_HEIGHT_DEFAULT);
  const totalHeight = hourHeight * 24;
  const contentWidth = screenWidth - GUTTER_WIDTH;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const baseHourHeight = useSharedValue(HOUR_HEIGHT_DEFAULT);
  const ghostY = useSharedValue(0);
  const ghostVisible = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    listTasks("day", date, "PENDING")
      .then((res) => {
        if (!cancelled) setTasks(res.tasks);
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
  }, [date.toISOString().slice(0, 10), refreshKey]);

  const refetch = useCallback(async () => {
    try {
      const res = await listTasks("day", date, "PENDING");
      setTasks(res.tasks);
      setError(false);
    } catch {
      setError(true);
    }
  }, [date]);

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
        await completeTask(taskId);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "DONE" as const } : t,
          ),
        );
        onComplete?.(taskId);
      } catch {
        refetch();
      }
    },
    [refetch, onComplete],
  );

  const segments = useMemo(() => {
    const blocks = tasksToBlocks(tasks);
    return eventsForDay(blocks, date, tz);
  }, [tasks, date, tz]);

  const layout = useMemo(() => getOverlapLayout(segments), [segments]);

  const scrollToNow = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        y: scrollToNowOffset(totalHeight),
        animated: false,
      });
    }
  }, [totalHeight]);

  const isToday = useMemo(() => {
    const now = zonedNow(tz);
    return (
      now.getFullYear() === date.getFullYear() &&
      now.getMonth() === date.getMonth() &&
      now.getDate() === date.getDate()
    );
  }, [date, tz]);

  const handleReschedule = useCallback(
    async (taskId: string, startISO: string) => {
      try {
        await rescheduleTask(taskId, startISO);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, scheduledStartTime: startISO } : t,
          ),
        );
      } catch {
        // Revert optimistic update on failure
        listTasks("day", date, "PENDING").then((res) => setTasks(res.tasks));
      }
    },
    [date],
  );

  const handleLongPress = useCallback(
    (y: number) => {
      const pxPerMin = totalHeight / DAILY_HORIZON;
      const minutes = Math.round(y / pxPerMin / TIME_GRANULARITY) * TIME_GRANULARITY;
      const clampedMin = Math.max(0, Math.min(DAILY_HORIZON - TIME_GRANULARITY, minutes));

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
      const minutes = Math.round(e.absoluteY / pxPerMin / TIME_GRANULARITY) * TIME_GRANULARITY;
      const clampedMin = Math.max(0, Math.min(DAILY_HORIZON - TIME_GRANULARITY, minutes));
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
    height: baseHourHeight.value * 24,
  }));

  const ghostStyle = useAnimatedStyle(() => ({
    top: ghostY.value,
    opacity: ghostVisible.value,
  }));

  if (loading) {
    return (
      <View className="flex-1 bg-background px-4 pt-4">
        <View className="mb-4 gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </View>
        <View className="flex-1 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-lg font-semibold">Failed to load</Text>
        <Text className="mt-2 text-center text-sm text-muted-foreground">
          Could not fetch your tasks. Pull down to retry.
        </Text>
      </View>
    );
  }

  if (segments.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-lg font-semibold">Nothing scheduled</Text>
        <Text className="mt-2 text-center text-sm text-muted-foreground">
          No tasks for {format(date, "EEEE, MMM d")}.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-baseline justify-between px-4 pt-3 pb-2">
        <Text className="text-lg font-bold">
          {format(date, "EEEE")}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {format(date, "MMM d")}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        onLayout={scrollToNow}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <GestureDetector gesture={contentGesture}>
          <Animated.View style={animatedContentStyle} className="relative">
            <TimeGutter hourHeight={hourHeight} />

            <View
              className="absolute top-0 bottom-0 bg-card"
              style={{ left: GUTTER_WIDTH, right: 0 }}
            >
               <WorkZoneOverlay date={date} prefs={prefs} hourHeight={hourHeight} />

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
                <NowIndicator tz={tz} totalHeight={totalHeight} />
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
                  <TaskBlock
                    key={segment.segmentId}
                    segment={segment}
                    layout={blockLayout}
                    tz={tz}
                    totalHeight={totalHeight}
                    leftOffset={leftOffsetPx}
                    blockWidth={blockWidthPx}
                    onReschedule={handleReschedule}
                    onPress={onTaskPress}
                    onComplete={handleComplete}
                  />
                );
              })}

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
      </ScrollView>
    </View>
  );
}
