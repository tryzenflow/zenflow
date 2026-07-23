import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { View, ScrollView, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DAILY_HORIZON,
  DEFAULT_WORK_PREFS,
  eventsForDay,
  tasksToBlocks,
  getOverlapLayout,
  zonedNow,
} from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { useUserStore } from "@/hooks/use-user-store";
import { listTasks } from "@/api/tasks";
import { TimeGutter } from "./time-gutter";
import { WorkZoneOverlay } from "./work-zone-overlay";
import { NowIndicator } from "./now-indicator";
import { TaskBlock } from "./task-block";
import { format } from "date-fns";

const GUTTER_WIDTH = 64;
const HOUR_HEIGHT_DEFAULT = 64;
const PX_PER_MIN = HOUR_HEIGHT_DEFAULT / 60;

function scrollToNowOffset(totalHeight: number): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, (mins / DAILY_HORIZON) * totalHeight - 120);
}

interface DayTimelineProps {
  date?: Date;
}

export function DayTimeline({ date: propDate }: DayTimelineProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const prefs = useUserStore((s) => s.user) ?? DEFAULT_WORK_PREFS;
  const scrollRef = useRef<ScrollView>(null);
  const { width: screenWidth } = useWindowDimensions();

  const date = propDate ?? zonedNow(tz);
  const totalHeight = HOUR_HEIGHT_DEFAULT * 24;
  const contentWidth = screenWidth - GUTTER_WIDTH;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
  }, [date.toISOString().slice(0, 10)]);

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
      >
        <View style={{ height: totalHeight }} className="relative">
          <TimeGutter hourHeight={HOUR_HEIGHT_DEFAULT} />

          <View
            className="absolute top-0 bottom-0 bg-card"
            style={{ left: GUTTER_WIDTH, right: 0 }}
          >
            <WorkZoneOverlay date={date} prefs={prefs} />

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
                />
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
