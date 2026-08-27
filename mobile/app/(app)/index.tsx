import { DaySlice } from "@/components/calendar/day-slice";
import {
  DayTimeline,
  type TimelineState,
} from "@/components/calendar/day-timeline";
import { CreateSessionFab } from "@/components/tasks/create-task-fab";
import { useUserStore } from "@/hooks/use-user-store";
import { useFocusEffect } from "@react-navigation/native";
import { zonedDate, zonedNow } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { SlideInUp, SlideOutDown } from "react-native-reanimated";

export default function DayScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const [refreshKey, setRefreshKey] = useState(0);
  const [timelineState, setTimelineState] = useState<TimelineState>("loading");
  const [sliceActive, setSliceActive] = useState(false);
  const [overnightTails, setOvernightTails] = useState<Session[]>([]);
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

  const handleSessionPress = useCallback(
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
    // No bottom padding here: the tab bar is a floating pill that overlays the
    // screen, so the timeline runs full-bleed and the grid shows through the
    // pill's side gutters and the gap beneath it. The ScrollView inside
    // `DayTimeline` pads its own content so the last hour still scrolls clear
    // of the pill.
    <View className="flex-1 bg-background">
      <DayTimeline
        date={date}
        onSessionPress={handleSessionPress}
        onLongPress={handleLongPress}
        refreshKey={refreshKey}
        onStateChange={setTimelineState}
        onReachBottom={handleReachBottom}
        onOvernightTailsChange={setOvernightTails}
      />
      {timelineState === "ready" && !sliceActive && (
        <CreateSessionFab tz={tz} />
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
