import { updateSession } from "@/api/tasks";
import { ChevronLeft, ChevronRight } from "@/components/Icons";
import {
  type MonthDragHandle,
  MonthPage,
} from "@/components/calendar/month-page";
import { MonthPager } from "@/components/calendar/month-pager";
import {
  RescheduleSheet,
  type RescheduleSheetHandle,
} from "@/components/calendar/reschedule-sheet";
import {
  SessionListSheet,
  type SessionListSheetHandle,
} from "@/components/calendar/task-list-sheet";
import {
  type PendingSessionUpdate,
  type UpdateRecurringScope,
  UpdateRecurringSheet,
  type UpdateRecurringSheetHandle,
} from "@/components/calendar/update-recurring-sheet";
import { CreateSessionFab } from "@/components/tasks/create-task-fab";
import { Text } from "@/components/ui/text";
import { useUserStore } from "@/hooks/use-user-store";
import { addMonths, monthLabel } from "@/lib/month-date-math";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { useFocusEffect } from "@react-navigation/native";
import { zonedNow } from "@zenflow/core";
import type { Session, UpdateScope } from "@zenflow/shared";
import { type Href, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, View } from "react-native";

/**
 * Month screen — RN migration Phase 4 (GitHub issue #21). Paginated
 * Monday-first grid (`MonthPager` → `MonthPage` → `MonthGrid`/`MonthCell`),
 * "+N more" overflow bottom sheet, tap-a-day → that day's detail sheet, and
 * long-press-drag a task pill to reschedule it to another day.
 *
 * Replaces the placeholder stub — see `mobile/README.md` and
 * `docs/react-native-migration.md` Phase 4.
 */
export default function MonthScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";

  // `monthDate` is the *committed* month — it drives which pages the pager
  // mounts, and only changes once a swipe has settled (or a chevron is
  // tapped). `visibleMonth` is what the header prints, and updates the moment
  // a swipe carries the next page past halfway, so the title tracks the
  // finger rather than trailing the scroll (and, before this, that page's
  // fetch).
  const [monthDate, setMonthDate] = useState(() => zonedNow(tz));
  const [visibleMonth, setVisibleMonth] = useState(monthDate);
  const [dragActive, setDragActive] = useState(false);
  // Bumped whenever the currently-focused page's data should be refetched —
  // returning from `/task/[id]/edit` (via `useFocusEffect`, same pattern as
  // Day View).
  const [reloadToken, setReloadToken] = useState(0);

  const tabBarOverlay = useTabBarOverlayHeight();

  const taskListSheetRef = useRef<SessionListSheetHandle>(null);
  const rescheduleSheetRef = useRef<RescheduleSheetHandle>(null);
  const updateScopeSheetRef = useRef<UpdateRecurringSheetHandle>(null);

  function goToMonth(next: Date) {
    setMonthDate(next);
    setVisibleMonth(next);
  }

  useFocusEffect(
    useCallback(() => {
      setReloadToken((n) => n + 1);
    }, []),
  );

  // Tapping a day opens the same detail sheet the "+N more" pill does,
  // listing that day's tasks in place — it no longer navigates away to Day
  // View, so the month stays on screen and the sheet is dismissible with no
  // side effect.
  // `drag` comes from the `MonthPage` that opened the sheet — i.e. the month
  // actually on screen — so long-press-dragging a row out of the sheet routes
  // straight back into that page's drag machinery.
  function openDay(day: Date, tasks: Session[], drag: MonthDragHandle) {
    taskListSheetRef.current?.open(day, tasks, drag);
  }

  function openSessionFromSheet(task: Session) {
    // A recurring occurrence's id is "<seriesId>::<startISO>" — encode it so
    // the `::` / `:` survive the route path (Expo Router decodes the param).
    router.push(`/task/${encodeURIComponent(task.id)}/edit` as Href);
  }

  // Day sheet's per-row "Move" button → the "Move to…" sheet, stacked on top.
  function openReschedule(task: Session) {
    rescheduleSheetRef.current?.open(task);
  }

  // Confirm: one `PATCH /sessions/:id`, then refetch the visible month and drop
  // the (now stale) day sheet. `scope`/`skipConflicting` are only set when the
  // session belongs to a series and `handleRequestScopedUpdate` below
  // resolved a choice.
  const handleRescheduleConfirm = useCallback(
    async (
      id: string,
      startISO: string,
      durationMinutes: number,
      scope?: UpdateScope,
      skipConflicting?: boolean,
    ) => {
      await updateSession(id, {
        scheduledStartTime: startISO,
        durationMinutes,
        scope,
        skipConflicting,
      });
      setReloadToken((n) => n + 1);
      taskListSheetRef.current?.close();
    },
    [],
  );

  // The shared `RescheduleSheet`'s scope-confirmation deferral — same wiring
  // as the Week screen's own instance.
  const handleRequestScopedUpdate = useCallback(
    (
      session: Session,
      pending: PendingSessionUpdate,
      onResolve: (
        choice: {
          scope: UpdateRecurringScope;
          skipConflicting: boolean;
        } | null,
      ) => void,
    ) => {
      updateScopeSheetRef.current?.open(session, pending, onResolve);
    },
    [],
  );

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row justify-between items-center gap-3 border-b border-border bg-background px-4 py-4">
        <View className="min-w-0 shrink gap-1">
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => goToMonth(addMonths(monthDate, -1))}
              hitSlop={8}
              accessibilityLabel="Previous month"
            >
              <ChevronLeft size={18} className="text-muted-foreground" />
            </Pressable>
            <Text
              numberOfLines={1}
              className="shrink text-xl font-bold tracking-tight"
            >
              {monthLabel(visibleMonth)}
            </Text>
            <Pressable
              onPress={() => goToMonth(addMonths(monthDate, 1))}
              hitSlop={8}
              accessibilityLabel="Next month"
            >
              <ChevronRight size={18} className="text-muted-foreground" />
            </Pressable>
          </View>
        </View>
      </View>

      {/* The grid's rows are a fixed `CELL_HEIGHT`, so anything the tab bar
          eats comes off the last week rather than shrinking the cells —
          pad by exactly the bar's opaque height and no more. */}
      <View className="flex-1" style={{ paddingBottom: tabBarOverlay }}>
        <MonthPager
          monthDate={monthDate}
          onMonthChange={goToMonth}
          onVisibleMonthChange={setVisibleMonth}
          scrollEnabled={!dragActive}
          renderPage={(pageMonthDate) => (
            <MonthPage
              monthDate={pageMonthDate}
              tz={tz}
              reloadToken={reloadToken}
              // Only the page the header is actually showing surfaces a load-
              // error toast — without this, the outer pager's off-screen
              // prev/next pages can fail their own fetch in the same tick as
              // the visible page and each would surface its own toast for a
              // page the user isn't looking at. (The toasts themselves no
              // longer collide on id if this ever fires simultaneously —
              // `components/ui/toast.tsx` now ids with a monotonic counter,
              // not `Date.now()` — but the gating here is still correct on
              // its own terms: a stale/off-screen page's error isn't user-
              // relevant.)
              isActive={
                monthLabel(pageMonthDate) === monthLabel(visibleMonth)
              }
              onDragActiveChange={setDragActive}
              onOpenDay={openDay}
              onOpenOverflow={openDay}
            />
          )}
        />
      </View>

      <SessionListSheet
        ref={taskListSheetRef}
        tz={tz}
        onSelectSession={openSessionFromSheet}
        onReschedule={openReschedule}
      />

      <RescheduleSheet
        ref={rescheduleSheetRef}
        tz={tz}
        onConfirm={handleRescheduleConfirm}
        onRequestScopedUpdate={handleRequestScopedUpdate}
      />
      <UpdateRecurringSheet ref={updateScopeSheetRef} />

      <CreateSessionFab tz={tz} />
    </View>
  );
}
