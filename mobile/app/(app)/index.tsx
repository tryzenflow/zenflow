import { CreateTaskFab } from "@/components/tasks/create-task-fab";
import { OptimizeFab } from "@/components/tasks/optimize-fab";
import { DayTimeline, type TimelineState } from "@/components/calendar/day-timeline";
import { DaySlice } from "@/components/calendar/day-slice";
import { useUserStore } from "@/hooks/use-user-store";
import { useScheduleRefresh } from "@/hooks/use-schedule-refresh";
import { zonedDate, zonedNow } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { SlideInUp, SlideOutDown } from "react-native-reanimated";
import { useFocusEffect } from "@react-navigation/native";

export default function DayScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const [refreshKey, setRefreshKey] = useState(0);
  const [timelineState, setTimelineState] = useState<TimelineState>("loading");
  const [sliceActive, setSliceActive] = useState(false);
  const [overnightTails, setOvernightTails] = useState<Task[]>([]);
  const [sliceDate, setSliceDate] = useState<Date>(() => zonedNow(tz));
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();

  // Accepts an optional `date` query param (ISO instant) so other screens can
  // deep-link into a specific day — currently only Month View's "tap a day
  // cell" gesture (`app/(app)/month.tsx`). `zonedDate` keeps the user-tz wall
  // clock in the local fields, never a bare `new Date()`.
  const date = useMemo(
    () => (dateParam ? zonedDate(dateParam, tz) : zonedNow(tz)),
    [dateParam, tz],
  );

  useFocusEffect(
    useCallback(() => {
      setRefreshKey((k) => k + 1);
    }, []),
  );

  // The Optimize action lives in the tab bar (and the FAB), outside this
  // screen. The tab-bar action announces itself through the store; the FAB
  // calls onApplied. Both bump refreshKey so DayTimeline refetches exactly
  // once per event.
  const scheduleRefreshToken = useScheduleRefresh((s) => s.token);
  const onOptimizeApplied = useCallback(
    () => setRefreshKey((k) => k + 1),
    [],
  );
  useEffect(() => {
    if (scheduleRefreshToken > 0) onOptimizeApplied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRefreshToken]);

  const handleTaskPress = useCallback(
    (taskId: string) => {
      router.push(`/task/${taskId}/edit` as Href);
    },
    [router],
  );

  const handleLongPress = useCallback(
    (timeISO: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      router.push({
        pathname: "/task/new",
        params: { start: timeISO },
      } as Href);
    },
    [router],
  );

  const handleReachBottom = useCallback(() => {
    if (overnightTails.length === 0) return;
    // Continue wherever the timeline is showing — the deep-linked day in
    // Month View, or wall-clock today for the tab-bar entry.
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    setSliceDate(next);
    setSliceActive(true);
  }, [overnightTails.length, date]);

  const handleCollapseSlice = useCallback(() => {
    setSliceActive(false);
  }, []);

  return (
    <View className="flex-1 bg-background">
      <DayTimeline
        date={date}
        onTaskPress={handleTaskPress}
        onLongPress={handleLongPress}
        refreshKey={refreshKey}
        onStateChange={setTimelineState}
        onReachBottom={handleReachBottom}
        onOvernightTailsChange={setOvernightTails}
      />
      {timelineState === "ready" && !sliceActive && <CreateTaskFab tz={tz} />}
      {timelineState === "ready" && !sliceActive && (
        <OptimizeFab tz={tz} onApplied={onOptimizeApplied} />
      )}
      {sliceActive && (
        <Animated.View
          entering={SlideInUp.duration(300)}
          exiting={SlideOutDown.duration(240)}
          className="absolute inset-0 z-40 bg-background"
        >
          <DaySlice
            date={sliceDate}
            tz={tz}
            tails={overnightTails}
            onCollapse={handleCollapseSlice}
          />
        </Animated.View>
      )}
    </View>
  );
}