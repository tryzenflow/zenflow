import { WeekHeader } from "@/components/calendar/week-header";
import { WeekPager } from "@/components/calendar/week-pager";
import { CreateTaskFab } from "@/components/tasks/create-task-fab";
import { useScheduleRefresh } from "@/hooks/use-schedule-refresh";
import { useUserStore } from "@/hooks/use-user-store";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { useFocusEffect } from "@react-navigation/native";
import { zonedNow } from "@zenflow/core";
import * as Haptics from "expo-haptics";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

export default function WeekScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";

  // `focusedDate` is the committed focus — it drives the WeekHeader title/range
  // and highlights, and the pager aligns itself to it. Swipes that settle on
  // an edge day slide the whole week, and chip taps re-center the pager; both
  // flow back through this one state.
  const [focusedDate, setFocusedDate] = useState(() => zonedNow(tz));
  // Bumped whenever every mounted day's timeline should refetch — screen
  // focus (returning from an edit), an Optimize apply, or a cross-day
  // reschedule (the source day refetches itself; the others need the bump).
  const [reloadKey, setReloadKey] = useState(0);
  // Shared vertical scroll position across all seven timelines, keeping them
  // in lockstep: a settle on any page stores the offset, and the tick bump
  // re-applies it to every page via each page's `scrollSyncTick` effect.
  const scrollYRef = useRef(0);
  const [scrollSyncTick, setScrollSyncTick] = useState(0);

  const tabBarOverlay = useTabBarOverlayHeight();

  useFocusEffect(
    useCallback(() => {
      setReloadKey((k) => k + 1);
    }, []),
  );

  // The Optimize action lives in the tab bar, outside this screen — an
  // apply/undo announces itself through the store (same pattern as Day and
  // Month View).
  const scheduleRefreshToken = useScheduleRefresh((s) => s.token);
  useEffect(() => {
    if (scheduleRefreshToken > 0) setReloadKey((k) => k + 1);
  }, [scheduleRefreshToken]);

  const handleScrollSettled = useCallback((y: number) => {
    scrollYRef.current = y;
    setScrollSyncTick((t) => t + 1);
  }, []);

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

  const handleCrossDayReschedule = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <View className="flex-1 bg-background">
      <WeekHeader
        focusedDate={focusedDate}
        tz={tz}
        onSelectDay={setFocusedDate}
      />

      <View className="flex-1" style={{ paddingBottom: tabBarOverlay }}>
        <WeekPager
          focusedDate={focusedDate}
          onFocusedDateChange={setFocusedDate}
          reloadKey={reloadKey}
          scrollYRef={scrollYRef}
          scrollSyncTick={scrollSyncTick}
          onScrollSettled={handleScrollSettled}
          onTaskPress={handleTaskPress}
          onLongPress={handleLongPress}
          onCrossDayReschedule={handleCrossDayReschedule}
        />
      </View>

      <CreateTaskFab tz={tz} />
    </View>
  );
}
