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
import { Pressable, ScrollView, View } from "react-native";

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

  const selectedKey = dateKey(selectedDate);
  const selectedInGrid = days.some((d) => dateKey(d) === selectedKey);
  const list = tasksByDate.get(selectedKey) ?? NO_SESSIONS;

  return (
    <View className="flex-1">
      <MonthGrid
        monthDate={monthDate}
        days={days}
        today={today}
        selectedKey={selectedKey}
        bars={bars}
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
              {sessions != null && list.length === 0 ? (
                <Text className="px-4 py-3 text-[13px] text-muted-foreground">
                  {t("Nothing scheduled")}
                </Text>
              ) : null}
              {list.map((session) => {
                const tone = sessionTone(deriveState(session), session.late);
                const continuation = isContinuationEntry(session);
                return (
                  <Pressable
                    key={`${session.id}${continuation ? ":tail" : ""}`}
                    testID={`month.row.${session.id}`}
                    onPress={() => onSessionPress(session.id)}
                    accessibilityRole="button"
                    accessibilityLabel={session.title}
                    className="mx-4 my-1 rounded-r-xl active:opacity-70"
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
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}
      </View>
    </View>
  );
});
