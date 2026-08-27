import { WeekHeader } from "@/components/calendar/week-header";
import { WeekPager } from "@/components/calendar/week-pager";
import { CreateSessionFab } from "@/components/tasks/create-task-fab";
import { useUserStore } from "@/hooks/use-user-store";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { useFocusEffect } from "@react-navigation/native";
import { zonedDate, zonedNow } from "@zenflow/core";
import * as Haptics from "expo-haptics";
import { type Href, useRouter } from "expo-router";
import { format } from "date-fns";
import { useCallback, useState } from "react";
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
  // Per-day reload tokens (keyed by `dateKey`) — a bump only refetches that
  // page's `DayTimeline`. Screen focus bumps every mounted day; a cross-day
  // reschedule bumps only the target day (the source day refetches itself via
  // its own `handleReschedule`).
  const [reloadKeyByDay, setReloadKeyByDay] = useState<Record<string, number>>(
    {},
  );

  const tabBarOverlay = useTabBarOverlayHeight();

  useFocusEffect(
    useCallback(() => {
      setReloadKeyByDay((prev) => {
        const next: Record<string, number> = {};
        for (const k of Object.keys(prev)) next[k] = prev[k] + 1;
        return next;
      });
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

  const handleCrossDayReschedule = useCallback(
    (_taskId: string, startISO: string) => {
      const targetKey = format(zonedDate(new Date(startISO), tz), "yyyy-MM-dd");
      setReloadKeyByDay((prev) => ({
        ...prev,
        [targetKey]: (prev[targetKey] ?? 0) + 1,
      }));
    },
    [tz],
  );

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
          reloadKeyByDay={reloadKeyByDay}
          onSessionPress={handleSessionPress}
          onLongPress={handleLongPress}
          onCrossDayReschedule={handleCrossDayReschedule}
        />
      </View>

      <CreateSessionFab tz={tz} />
    </View>
  );
}
