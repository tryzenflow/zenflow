import { Skeleton } from "@/components/ui/skeleton";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { listSessions } from "@/api/tasks";
import { MonthGrid } from "@/components/calendar/month-grid";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useLanguage } from "@/hooks/use-language";
import { useScreenFocusedRef } from "@/hooks/use-screen-focused-ref";
import { useConnectivity } from "@/lib/connectivity";
import { dayBarsByDay } from "@/lib/day-bar";
import { format, t } from "@/lib/i18n";
import {
  dateKey,
  getMonthGridDays,
  groupSessionsByDate,
  isContinuationEntry,
} from "@/lib/month-date-math";
import {
  fetchDaySessions,
  getCachedDaySessions,
  isDayCacheFresh,
  sameSessions,
  subscribeToSessionMutations,
} from "@/lib/session-cache";
import { sessionTimeRange } from "@/lib/session-search-list";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { showErrorToast } from "@/lib/task-toasts";
import { deriveState, SESSION_TONES, sessionTone, zonedNow } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  type HostInstance,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { CELL_HEIGHT } from "@/components/calendar/month-cell";

interface MonthPageProps {
  monthDate: Date;
  tz: string;
  /** Bumped by the caller whenever this page's data should be refetched. */
  reloadToken: number;
  /** True only for the page the header shows; off-screen neighbours still
   * fetch but stay quiet on failure. */
  isActive: boolean;
  /** The selected day (any month: shown when it is in this page's grid). */
  selectedDate: Date;
  onSelectDay: (day: Date) => void;
  onOpenDay: (day: Date) => void;
  onSessionPress: (sessionId: string) => void;
  /** A session from the list was dropped on another day of the grid. */
  onMoveSession?: (session: Session, day: Date) => void;
}

/** Where the grid and the page sit in the window, for hit-testing a drag. */
interface DragGeometry {
  pageX: number;
  pageY: number;
  gridX: number;
  gridY: number;
  gridW: number;
}

const NO_GEOMETRY: DragGeometry = { pageX: 0, pageY: 0, gridX: 0, gridY: 0, gridW: 0 };
const LIFT_HOLD_MS = 350;

/**
 * One row of the selected day's list. Tap opens it; hold and drag lifts it, and
 * the page's grid highlights the day under the finger. The row never moves
 * itself (the list clips it): a ghost drawn by the page follows the finger.
 */
function SessionRow({
  session,
  continuation,
  tz,
  dayKeys,
  rows,
  geometry,
  ghostX,
  ghostY,
  ghostOn,
  onPress,
  onBegin,
  onHover,
  onDrop,
}: {
  session: Session;
  continuation: boolean;
  tz: string;
  dayKeys: string[];
  rows: number;
  geometry: SharedValue<DragGeometry>;
  ghostX: SharedValue<number>;
  ghostY: SharedValue<number>;
  ghostOn: SharedValue<number>;
  onPress: (id: string) => void;
  onBegin: (session: Session) => void;
  onHover: (key: string | null) => void;
  onDrop: (session: Session, key: string | null) => void;
}) {
  const tone = sessionTone(deriveState(session), session.late);
  const lastKey = useSharedValue<string | null>(null);
  const canDrag = !continuation && !!session.scheduledStartTime;

  const press = useCallback(() => onPress(session.id), [onPress, session.id]);
  const lift = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onBegin(session);
  }, [onBegin, session]);
  const drop = useCallback(
    (key: string | null) => onDrop(session, key),
    [onDrop, session],
  );

  const pan = Gesture.Pan()
    .enabled(canDrag)
    .activateAfterLongPress(LIFT_HOLD_MS)
    .onStart(() => {
      lastKey.value = null;
      ghostOn.value = 1;
      runOnJS(lift)();
    })
    .onUpdate((e) => {
      const g = geometry.value;
      ghostX.value = e.absoluteX - g.pageX;
      ghostY.value = e.absoluteY - g.pageY;
      const col = Math.floor((e.absoluteX - g.gridX) / Math.max(1, g.gridW / 7));
      const row = Math.floor((e.absoluteY - g.gridY) / CELL_HEIGHT);
      const inside = g.gridW > 0 && col >= 0 && col < 7 && row >= 0 && row < rows;
      const key = inside ? dayKeys[row * 7 + col] : null;
      if (key !== lastKey.value) {
        lastKey.value = key;
        runOnJS(onHover)(key);
      }
    })
    .onEnd((_e, success) => {
      if (success) runOnJS(drop)(lastKey.value);
    })
    .onFinalize(() => {
      ghostOn.value = 0;
      lastKey.value = null;
      runOnJS(onHover)(null);
    });
  const tap = Gesture.Tap()
    .maxDuration(LIFT_HOLD_MS - 50)
    .onEnd(() => {
      runOnJS(press)();
    });

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, tap)}>
      <Animated.View
        testID={`month.row.${session.id}`}
        accessible
        accessibilityRole="button"
        accessibilityLabel={session.title}
        className="mx-4 my-1 rounded-r-xl"
        style={{
          borderLeftWidth: 3,
          borderLeftColor: SESSION_TONES[tone].base,
        }}
      >
        <View className="gap-0.5 py-2 pl-3">
          <Text className="text-[12px] text-muted-foreground">
            {sessionTimeRange(session, tz)}
          </Text>
          <Text numberOfLines={1} className="text-[15px] font-semibold">
            {session.title}
          </Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const NO_SESSIONS: Session[] = [];

/**
 * One month: the compact grid with load bars, and under it the selected day's
 * sessions. Owns its fetch (`GET /sessions?view=month`, padded to whole weeks
 * server-side) and paints from the shared cache first, so a page remounted by
 * the pager appears at once.
 */
export const MonthPage = memo(function MonthPage({
  monthDate,
  tz,
  reloadToken,
  isActive,
  selectedDate,
  onSelectDay,
  onOpenDay,
  onSessionPress,
  onMoveSession,
}: MonthPageProps) {
  useLanguage();
  const { toast } = useToast();
  const tabBarOverlay = useTabBarOverlayHeight();
  const monthKey = `month:${format(monthDate, "yyyy-MM")}`;
  const [sessions, setSessions] = useState<Session[] | null>(
    () => getCachedDaySessions(monthKey) ?? null,
  );

  const days = useMemo(() => getMonthGridDays(monthDate), [monthDate]);
  const today = useMemo(() => zonedNow(tz), [tz]);

  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const refetch = useCallback(async () => {
    try {
      const fetched = await fetchDaySessions(monthKey, async () => {
        const res = await listSessions("month", monthDate);
        return res.sessions;
      });
      setSessions((prev) =>
        prev != null && sameSessions(prev, fetched) ? prev : fetched,
      );
      useConnectivity.getState().setStale(monthKey, false);
    } catch (error) {
      const saved = getCachedDaySessions(monthKey);
      if (saved) {
        setSessions((cur) => cur ?? saved);
        useConnectivity.getState().setStale(monthKey, true);
        return;
      }
      setSessions((cur) => cur ?? []);
      if (isActiveRef.current) {
        showErrorToast(toast, error, t("Couldn't load this month"), "calendar-x");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate, monthKey]);

  useEffect(() => {
    if (isDayCacheFresh(monthKey)) {
      const cached = getCachedDaySessions(monthKey);
      if (cached) {
        setSessions((prev) =>
          prev != null && sameSessions(prev, cached) ? prev : cached,
        );
      }
      return;
    }
    refetch();
  }, [refetch, reloadToken, monthKey]);

  const screenFocused = useScreenFocusedRef();
  useEffect(() => {
    return subscribeToSessionMutations(() => {
      if (screenFocused.current) refetch();
    });
  }, [refetch, screenFocused]);

  const tasksByDate = useMemo(
    () => groupSessionsByDate(sessions ?? [], tz),
    [sessions, tz],
  );
  const bars = useMemo(() => dayBarsByDay(sessions ?? [], tz), [sessions, tz]);

  const loading = useDelayedLoading(sessions === null);

  // Drag a session from the list onto a day of the grid.
  const pageRef = useRef<HostInstance>(null);
  const gridBodyRef = useRef<HostInstance>(null);
  const geometry = useSharedValue<DragGeometry>(NO_GEOMETRY);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostOn = useSharedValue(0);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Session | null>(null);
  const dayKeys = useMemo(() => days.map(dateKey), [days]);
  const rows = days.length / 7;

  const beginDrag = useCallback((session: Session) => {
    setDragging(session);
    pageRef.current?.measureInWindow((pageX, pageY) => {
      gridBodyRef.current?.measureInWindow((gridX, gridY, gridW) => {
        geometry.value = { pageX, pageY, gridX, gridY, gridW };
      });
    });
  }, [geometry]);
  const dropSession = useCallback(
    (session: Session, key: string | null) => {
      setDragging(null);
      setHoverKey(null);
      const day = key ? days[dayKeys.indexOf(key)] : undefined;
      if (day) onMoveSession?.(session, day);
    },
    [days, dayKeys, onMoveSession],
  );
  const endHover = useCallback((key: string | null) => setHoverKey(key), []);
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOn.value,
    transform: [
      { translateX: ghostX.value - 70 },
      { translateY: ghostY.value - 56 },
    ],
  }));

  const selectedKey = dateKey(selectedDate);
  const selectedInGrid = days.some((d) => dateKey(d) === selectedKey);
  const list = tasksByDate.get(selectedKey) ?? NO_SESSIONS;

  return (
    <View ref={pageRef} collapsable={false} className="flex-1">
      <MonthGrid
        monthDate={monthDate}
        days={days}
        today={today}
        selectedKey={selectedKey}
        bars={bars}
        bodyRef={gridBodyRef}
        dropKey={hoverKey}
        onPressDay={onSelectDay}
      />
      <View className="mt-2 flex-1 border-t border-border">
        {selectedInGrid ? (
          <>
            <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
              <Text className="text-[13px] font-semibold text-muted-foreground">
                {format(selectedDate, "EEEE, d MMMM")}
              </Text>
              <Pressable
                onPress={() => onOpenDay(selectedDate)}
                hitSlop={8}
                accessibilityRole="button"
                testID="month.open-day"
              >
                <Text className="text-[13px] font-semibold text-primary">
                  {t("Open day")}
                </Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={{ paddingBottom: tabBarOverlay + 24 }}
              showsVerticalScrollIndicator={false}
            >
              {loading ? (
                <View testID="month.skeleton" className="gap-3 px-4 pt-3">
                  {[0, 1, 2].map((i) => (
                    <View key={i} className="gap-1.5">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-4 w-4/5" />
                    </View>
                  ))}
                </View>
              ) : null}
              {sessions != null && list.length === 0 ? (
                <Text className="px-4 py-3 text-[13px] text-muted-foreground">
                  {t("Nothing scheduled")}
                </Text>
              ) : null}
              {list.map((session) => (
                <SessionRow
                  key={`${session.id}${isContinuationEntry(session) ? ":tail" : ""}`}
                  session={session}
                  continuation={isContinuationEntry(session)}
                  tz={tz}
                  dayKeys={dayKeys}
                  rows={rows}
                  geometry={geometry}
                  ghostX={ghostX}
                  ghostY={ghostY}
                  ghostOn={ghostOn}
                  onPress={onSessionPress}
                  onBegin={beginDrag}
                  onHover={endHover}
                  onDrop={dropSession}
                />
              ))}
            </ScrollView>
          </>
        ) : null}
      </View>
      {dragging ? (
        <Animated.View
          pointerEvents="none"
          testID="month.drag-ghost"
          style={[
            ghostStyle,
            StyleSheet.absoluteFill,
            { right: undefined, bottom: undefined, width: 140, zIndex: 50 },
          ]}
        >
          <View className="rounded-full bg-primary px-3 py-2 shadow-lg">
            <Text
              numberOfLines={1}
              className="text-[13px] font-semibold text-primary-foreground"
            >
              {dragging.title}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
});
