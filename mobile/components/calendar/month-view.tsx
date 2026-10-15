import { t } from "@/lib/i18n";
import { navigateOnce } from "@/lib/nav";
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
import { resolveMoveScope } from "@/lib/recurring-scope";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { showSkippedToast } from "@/lib/task-toasts";
import { addMonths, monthLabel } from "@/lib/month-date-math";
import type { Session, UpdateScope } from "@zenflow/shared";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

interface MonthViewProps {
  /** Any day in the month on screen; a swipe or chevron reports the new one through `onDateChange`. */
  date: Date;
  onDateChange: (date: Date) => void;
  tz: string;
  /** Bumped by the parent on screen focus so the visible month refetches. */
  reloadToken: number;
  /** Double-tap a day: the parent switches to Day view on it. */
  onOpenDay: (day: Date) => void;
}

/**
 * Month view of the calendar screen: a paginated Monday-first grid
 * (`MonthPager` → `MonthPage` → `MonthGrid`/`MonthCell`), a "+N more" and
 * tap-a-day sheet listing that day's tasks, and long-press-drag a task pill to
 * reschedule it to another day. Hosted by `app/(app)/index.tsx`.
 */
export function MonthView({
  date,
  onDateChange,
  tz,
  reloadToken: parentReloadToken,

  onOpenDay,
}: MonthViewProps) {
  const { toast } = useToast();
  const router = useRouter();

  // `monthDate` is the committed month — it drives which pages the pager
  // mounts. `visibleMonth` is what the header prints, and updates the moment a
  // swipe carries the next page past halfway, so the title tracks the finger.
  const [monthDate, setMonthDate] = useState(date);
  const [visibleMonth, setVisibleMonth] = useState(date);
  const [dragActive, setDragActive] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const taskListSheetRef = useRef<SessionListSheetHandle>(null);
  const rescheduleSheetRef = useRef<RescheduleSheetHandle>(null);

  // A date from the parent (view switch, Today) re-seeds the month on screen.
  const lastDateRef = useRef(date);
  useEffect(() => {
    if (monthLabel(lastDateRef.current) === monthLabel(date)) return;
    lastDateRef.current = date;
    setMonthDate(date);
    setVisibleMonth(date);
  }, [date]);

  const goToMonth = useCallback(
    (next: Date) => {
      setMonthDate(next);
      setVisibleMonth(next);
      lastDateRef.current = next;
      onDateChange(next);
    },
    [onDateChange],
  );

  // Tapping a day opens the detail sheet listing that day's tasks in place.
  // `drag` comes from the `MonthPage` that opened the sheet, so long-press-
  // dragging a row out of the sheet routes back into that page's drag code.
  // Stable identity: `MonthPage` is memoized.
  const openDay = useCallback(
    (day: Date, tasks: Session[], drag: MonthDragHandle) => {
      taskListSheetRef.current?.open(day, tasks, drag);
    },
    [],
  );

  // Double-tap a day cell → Day view on that day.
  const handleDoubleTapDay = useCallback(
    (day: Date) => {
      onOpenDay(day);
    },
    [onOpenDay],
  );

  function openSessionFromSheet(task: Session) {
    // A recurring occurrence's id is "<seriesId>::<startISO>" — encode it so
    // the `::` / `:` survive the route path (Expo Router decodes the param).
    navigateOnce(() =>
      router.push(`/task/${encodeURIComponent(task.id)}/edit` as Href),
    );
  }

  // Day sheet's per-row "Move" button → the "Move to…" sheet, stacked on top.
  function openReschedule(task: Session) {
    rescheduleSheetRef.current?.open(task);
  }

  // Confirm: one `PATCH /sessions/:id`, then refetch the visible month and drop
  // the (now stale) day sheet.
  const handleRescheduleConfirm = useCallback(
    async (
      id: string,
      startISO: string,
      durationMinutes: number,
      scope?: UpdateScope,
      skipConflicting?: boolean,
    ) => {
      const res = await updateSession(id, {
        scheduledStartTime: startISO,
        durationMinutes,
        scope,
        skipConflicting,
      });
      showSkippedToast(toast, res.skippedSessionIds);
      setReloadToken((n) => n + 1);
      taskListSheetRef.current?.close();
    },
    [toast],
  );

  // Same scope rule as the calendar screen: a recurring session asks nothing,
  // a multi-sitting task asks which sittings.
  const updateScopeSheetRef = useRef<UpdateRecurringSheetHandle>(null);
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
      resolveMoveScope(toast, session, pending, onResolve, (s, p, r) =>
        updateScopeSheetRef.current?.open(s, p, r),
      );
    },
    [toast],
  );

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-3 border-b border-border bg-background px-4 pb-3 pt-1">
        <View className="min-w-0 shrink flex-row items-center gap-2">
          <Pressable
            onPress={() => goToMonth(addMonths(monthDate, -1))}
            hitSlop={8}
            accessibilityLabel={t("Previous month")}
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
            accessibilityLabel={t("Next month")}
          >
            <ChevronRight size={18} className="text-muted-foreground" />
          </Pressable>
        </View>
      </View>

      {/* The grid fills the space down to the floating bar, so every week row
          is fully visible. */}
      <View className="flex-1">
        <MonthPager
          monthDate={monthDate}
          onMonthChange={goToMonth}
          onVisibleMonthChange={setVisibleMonth}
          scrollEnabled={!dragActive}
          renderPage={(pageMonthDate) => (
            <MonthPage
              monthDate={pageMonthDate}
              tz={tz}
              reloadToken={reloadToken + parentReloadToken}
              // Only the page the header is showing surfaces a load-error
              // toast; off-screen neighbours must not toast for a page the
              // user isn't looking at.
              isActive={monthLabel(pageMonthDate) === monthLabel(visibleMonth)}
              onDragActiveChange={setDragActive}
              onOpenDay={openDay}
              onOpenOverflow={openDay}
              onDoubleTapDay={handleDoubleTapDay}
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

      <UpdateRecurringSheet ref={updateScopeSheetRef} />
      <RescheduleSheet
        ref={rescheduleSheetRef}
        tz={tz}
        onConfirm={handleRescheduleConfirm}
        onRequestScopedUpdate={handleRequestScopedUpdate}
      />
    </View>
  );
}
