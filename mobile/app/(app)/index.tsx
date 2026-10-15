import { TodayCard } from "@/components/calendar/today-card";
import { navigateOnce } from "@/lib/nav";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { getSessionDetails, updateSession } from "@/api/tasks";
import { findCachedSession } from "@/lib/session-cache";
import { showErrorToast, showSkippedToast } from "@/lib/task-toasts";
import {
  SessionDetailSheet,
  type SessionDetailSheetHandle,
} from "@/components/calendar/session-detail-sheet";
import type { TimelineState } from "@/components/calendar/day-timeline";
import {
  RescheduleSheet,
  type RescheduleSheetHandle,
} from "@/components/calendar/reschedule-sheet";
import {
  type PendingSessionUpdate,
  resolveMoveScope,
} from "@/lib/recurring-scope";
import {
  UpdateRecurringSheet,
  type UpdateRecurringSheetHandle,
} from "@/components/calendar/update-recurring-sheet";
import {
  BlockActionsSheet,
  type BlockActionsSheetHandle,
} from "@/components/calendar/block-actions-sheet";
import { CalendarHeader } from "@/components/calendar/calendar-header";
import { MonthView } from "@/components/calendar/month-view";
import { SessionSearchView } from "@/components/calendar/session-search-view";
import { TodayButton } from "@/components/calendar/today-button";
import {
  type CalendarView,
} from "@/components/calendar/view-switch";
import {
  WeekHeader,
  type WeekHeaderHandle,
} from "@/components/calendar/week-header";
import {
  WeekPager,
  type WeekPagerHandle,
} from "@/components/calendar/week-pager";
import { WeekGrid } from "@/components/calendar/week-grid";
import { useOffline } from "@/hooks/use-offline";
import { CreateSessionFab } from "@/components/tasks/create-task-fab";
import { useUserStore } from "@/hooks/use-user-store";
import { useWeekDayTypes } from "@/hooks/use-week-day-types";
import { dateKey, weekStart } from "@/lib/week-date-math";
import { monthLabel } from "@/lib/month-date-math";
import { zonedDate, zonedNow } from "@zenflow/core";
import type { Session, UpdateScope } from "@zenflow/shared";
import { differenceInCalendarDays } from "date-fns";
import {
  type Href,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useTodayRequest } from "@/lib/today-request";
import { useCallback, useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useToast } from "@/components/ui/toast";

const VIEWS: readonly CalendarView[] = ["day", "week", "month"];

function isCalendarView(value: string | undefined): value is CalendarView {
  return value !== undefined && (VIEWS as readonly string[]).includes(value);
}

/**
 * Calendar screen (the app's home tab). One header switches between three
 * views over the same focused date: Day (the paginated day timeline with its
 * 7-day chip strip), Week (seven columns, see `week-grid.tsx`) and Month (see
 * `month-view.tsx`). Switching views keeps the focused date.
 *
 * `focusedDate` is the committed focus. Day view's header prints `visibleDate`,
 * which tracks the finger during a swipe and reconciles to `focusedDate` on
 * settle.
 */
export default function CalendarScreen() {
  useLanguage();
  const router = useRouter();
  const offline = useOffline();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const {
    date: dateParam,
    flash: flashParam,
    view: viewParam,
  } = useLocalSearchParams<{
    date?: string;
    flash?: string;
    view?: string;
  }>();

  const [view, setView] = useState<CalendarView>(() =>
    isCalendarView(viewParam) ? viewParam : "day",
  );
  const everShown = useRef(new Set<CalendarView>());
  // Seeds from the optional `date` query param (ISO instant) so another screen
  // can deep-link into a specific day. `zonedDate` keeps the user-tz wall clock
  // in the local fields, never a bare `new Date()`.
  const [focusedDate, setFocusedDate] = useState(() =>
    dateParam ? zonedDate(dateParam, tz) : zonedNow(tz),
  );
  // What Day view's header prints. Tracks the finger during a swipe (the pager
  // reports the centred day per whole-page crossing via `onVisibleDateChange`),
  // then reconciles to `focusedDate` on settle.
  const [visibleDate, setVisibleDate] = useState(focusedDate);
  // A committed focus change (swipe settle, chip tap, deep link) moves both.
  const commitFocusedDate = useCallback((day: Date) => {
    setFocusedDate(day);
    setVisibleDate(day);
  }, []);
  // The user picked a day in the Day strip (chip tap or swipe).
  const handleUserSwitchDay = useCallback(
    (day: Date) => {
      commitFocusedDate(day);
    },
    [commitFocusedDate],
  );
  const handleVisibleDateChange = useCallback((day: Date) => {
    setVisibleDate((cur) => (dateKey(cur) === dateKey(day) ? cur : day));
  }, []);
  const handleViewChange = useCallback(
    (next: CalendarView) => {
      setVisibleDate(focusedDate);
      setView(next);
    },
    [focusedDate],
  );
  // Week and Month "open this day" (tap a Week header, double-tap a Month
  // cell): Day view on that day.
  const openDayView = useCallback(
    (day: Date) => {
      commitFocusedDate(day);
      setView("day");
    },
    [commitFocusedDate],
  );
  // Month swipes and chevrons move the focus to the month they land on.
  const handleMonthDateChange = useCallback(
    (next: Date) => {
      commitFocusedDate(next);
    },
    [commitFocusedDate],
  );
  // Global refetch tick — bumped on every screen focus so *every* mounted day
  // re-syncs (a task created/edited on another screen shows up the moment we
  // return, no manual pull-to-refresh).
  const [focusTick, setFocusTick] = useState(0);
  // Load state of the focused Day page, reported up by the pager — gates the FAB.
  const [timelineState, setTimelineState] = useState<TimelineState>("loading");
  // Session id to pulse on the focused day — set by a create/edit teleport
  // (`?flash=` param) or a cross-day drop, cleared after the entrance.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armFlash = useCallback((id: string) => {
    setFlashId(id);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashId(null), 1200);
  }, []);
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  // Per-day distinct session types for the visible week, for the header's
  // dot row — see `use-week-day-types.ts`.
  const dayTypes = useWeekDayTypes(visibleDate, tz, focusTick);

  // Strip offsets shared by the Day header and pager so their week transitions
  // move in lockstep. Rest = `-width` (focused page / middle week block
  // centered). Owned here — the nearest common parent.
  const { width } = useWindowDimensions();
  const progressSV = useSharedValue(-width);
  const headerStripSV = useSharedValue(-width);
  const pagerRef = useRef<WeekPagerHandle>(null);
  const headerRef = useRef<WeekHeaderHandle>(null);
  const rescheduleSheetRef = useRef<RescheduleSheetHandle>(null);
  const updateScopeSheetRef = useRef<UpdateRecurringSheetHandle>(null);
  const blockActionsSheetRef = useRef<BlockActionsSheetHandle>(null);
  const sessionDetailSheetRef = useRef<SessionDetailSheetHandle>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const handleWeekDragBegin = useCallback(() => {
    pagerRef.current?.beginHeaderWeekDrag();
  }, []);
  const handleWeekDragSettle = useCallback((dir: -1 | 1) => {
    pagerRef.current?.settleHeaderWeekDrag(dir);
  }, []);
  const handleWeekDragAbort = useCallback(() => {
    pagerRef.current?.abortHeaderWeekDrag();
  }, []);
  const handleWeekSlideStart = useCallback(() => {
    headerRef.current?.onWeekSlideStart();
  }, []);
  const handleWeekSlideEnd = useCallback((dir: -1 | 1) => {
    headerRef.current?.onWeekSlideEnd(dir);
  }, []);

  // Keep the shared offsets at rest across a width change (rotation).
  useEffect(() => {
    progressSV.value = -width;
    headerStripSV.value = -width;
  }, [width, progressSV, headerStripSV]);

  useFocusEffect(
    useCallback(() => {
      setFocusTick((t) => t + 1);
    }, []),
  );

  // A fresh deep-link (`date` param changed) re-seeds the focus.
  const lastParamRef = useRef(dateParam);
  useEffect(() => {
    if (dateParam && dateParam !== lastParamRef.current) {
      lastParamRef.current = dateParam;
      commitFocusedDate(zonedDate(dateParam, tz));
    }
  }, [dateParam, tz, commitFocusedDate]);

  // The Today tab: show today in Day view, from any view.
  const todayNonce = useTodayRequest((s) => s.nonce);
  const lastTodayNonce = useRef(todayNonce);
  useEffect(() => {
    if (todayNonce === lastTodayNonce.current) return;
    lastTodayNonce.current = todayNonce;
    commitFocusedDate(zonedNow(tz));
    setView("day");
  }, [todayNonce, tz, commitFocusedDate]);

  // A deep-link to a view (`view` param, e.g. the Today tab) switches to it.
  const lastViewParamRef = useRef(viewParam);
  useEffect(() => {
    if (isCalendarView(viewParam) && viewParam !== lastViewParamRef.current) {
      lastViewParamRef.current = viewParam;
      setView(viewParam);
    }
  }, [viewParam]);

  // A create/edit teleport (`?flash=<sessionId>`): revalidate every mounted day
  // so the new/moved block is present, pulse it, then drop the param so it
  // doesn't re-fire on the next visit.
  const lastFlashParamRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!flashParam || flashParam === lastFlashParamRef.current) return;
    lastFlashParamRef.current = flashParam;
    setFocusTick((t) => t + 1);
    armFlash(flashParam);
    router.setParams({ flash: undefined });
  }, [flashParam, armFlash, router]);

  // Tapping a block opens its detail sheet in place. The calendar cache holds
  // the session already; otherwise it is fetched first.
  const handleSessionPress = useCallback(
    (taskId: string) => {
      const cached = findCachedSession(taskId);
      if (cached) {
        sessionDetailSheetRef.current?.open(cached);
        return;
      }
      getSessionDetails(taskId)
        .then((session) => sessionDetailSheetRef.current?.open(session))
        .catch((error) =>
          showErrorToast(toast, error, t("Couldn't open this session"), "calendar-x"),
        );
    },
    [toast],
  );

  // Long-press a block → open the "Move to…" sheet for that session.
  const handleRequestReschedule = useCallback((session: Session) => {
    rescheduleSheetRef.current?.open(session);
  }, []);

  // Long-press a block → open its action menu (Move to… / Add study session
  // before this).
  const handleRequestBlockMenu = useCallback((session: Session) => {
    blockActionsSheetRef.current?.open(session);
  }, []);

  // "Add study session before this" → a new TASK whose deadline is the block's
  // start, pre-filled with roughly half the whole days until then as its
  // session count (min 1).
  const handleSessionBefore = useCallback(
    (session: Session) => {
      const start = session.scheduledStartTime;
      if (!start) {
        rescheduleSheetRef.current?.open(session);
        return;
      }
      const daysUntil = Math.max(
        1,
        differenceInCalendarDays(zonedDate(start, tz), zonedNow(tz)),
      );
      const sessions = Math.max(1, Math.floor(daysUntil / 2));
      navigateOnce(() =>
        router.push({
          pathname: "/task/new",
          params: {
            deadline: start,
            sessions: String(sessions),
            title: t("Prepare for {title}", { title: session.title }),
          },
        } as Href),
      );
    },
    [tz, router],
  );

  // The sheet's confirm — a single `PATCH /sessions/:id` (move + resize).
  // `scope`/`skipConflicting` are only set when the session belongs to a
  // series and `handleRequestScopedUpdate` below resolved a choice.
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
    },
    [toast],
  );

  // A drag/reschedule of a series member: a recurring session asks nothing
  // (this occurrence, with apply to all), a multi-sitting task asks which
  // sittings. `onResolve` gets the scope the caller commits with (`null` on undo).
  const handleRequestScopedUpdate = useCallback(
    (
      session: Session,
      pending: PendingSessionUpdate,
      onResolve: Parameters<typeof resolveMoveScope>[3],
    ) => {
      resolveMoveScope(toast, session, pending, onResolve, (s, p, r) =>
        updateScopeSheetRef.current?.open(s, p, r),
      );
    },
    [toast],
  );

  // …and once it lands: if it moved off the focused day, teleport there; then
  // force every mounted day to revalidate (so the block shows in its new place
  // and clears from the old) and pulse it. This is the body the old cross-day
  // drag drop used to run.
  const handleMoved = useCallback(
    (session: Session, startISO: string) => {
      const landed = zonedDate(startISO, tz);
      if (dateKey(landed) !== dateKey(focusedDate)) {
        commitFocusedDate(landed);
      }
      armFlash(session.id);
      setFocusTick((t) => t + 1);
    },
    [tz, focusedDate, commitFocusedDate, armFlash],
  );

  // Today: the day the Day view is on, the week Week view is on, or the month
  // Month view is on. The button shows when that differs from now.
  const now = zonedNow(tz);
  const isAtToday =
    view === "month"
      ? monthLabel(focusedDate) === monthLabel(now)
      : view === "week"
        ? dateKey(weekStart(focusedDate)) === dateKey(weekStart(now))
        : dateKey(visibleDate) === dateKey(now);

  // Every view keeps a fixed slot under the screen root and, once opened, stays
  // mounted (hidden with display none). Mounting or unmounting a whole view in
  // the same commit as its siblings shifts child indices and Fabric asserts.
  everShown.current.add(view);
  const slotStyle = (id: CalendarView) =>
    view === id ? undefined : ({ display: "none" } as const);

  return (
    <View className="flex-1 bg-background">
      <CalendarHeader
        view={view}
        onViewChange={handleViewChange}
        offlineKey={`${view}:${dateKey(focusedDate)}`}
        onSearch={() => setSearchOpen(true)}
      />

      <View className="flex-1" style={slotStyle("day")}>
        {everShown.current.has("day") ? (
        <>
          <WeekHeader
            ref={headerRef}
            focusedDate={focusedDate}
            displayDate={visibleDate}
            tz={tz}
            onSelectDay={handleUserSwitchDay}
            progressSV={progressSV}
            headerStripSV={headerStripSV}
            onWeekDragBegin={handleWeekDragBegin}
            onWeekDragSettle={handleWeekDragSettle}
            onWeekDragAbort={handleWeekDragAbort}
            dayTypes={dayTypes}
          />

          <TodayCard tz={tz} onOpenSession={handleSessionPress} />

          <View className="flex-1">
            <WeekPager
              ref={pagerRef}
              focusedDate={focusedDate}
              onFocusedDateChange={handleUserSwitchDay}
              onVisibleDateChange={handleVisibleDateChange}
              focusTick={focusTick}
              onSessionPress={handleSessionPress}
              progressSV={progressSV}
              headerStripSV={headerStripSV}
              onWeekSlideStart={handleWeekSlideStart}
              onWeekSlideEnd={handleWeekSlideEnd}
              onActiveStateChange={setTimelineState}
              onRequestReschedule={handleRequestReschedule}
              onRequestBlockMenu={handleRequestBlockMenu}
              onRequestScopedUpdate={handleRequestScopedUpdate}
              flashSessionId={flashId}
            />
          </View>
        </>
        ) : null}
      </View>

      <View className="flex-1" style={slotStyle("week")}>
        {everShown.current.has("week") ? (
        <WeekGrid
          anchor={focusedDate}
          tz={tz}
          focusTick={focusTick}
          onWeekChange={commitFocusedDate}
          onDayPress={openDayView}
          onSessionPress={handleSessionPress}
          onRequestReschedule={handleRequestReschedule}
          onRequestBlockMenu={handleRequestBlockMenu}
          onRequestScopedUpdate={handleRequestScopedUpdate}
        />
        ) : null}
      </View>

      <View className="flex-1" style={slotStyle("month")}>
        {everShown.current.has("month") ? (
        <MonthView
          date={focusedDate}
          onDateChange={handleMonthDateChange}
          tz={tz}
          reloadToken={focusTick}
          onOpenDay={openDayView}
        />
        ) : null}
      </View>

      <TodayButton
        visible={!isAtToday}
        onPress={() => commitFocusedDate(zonedNow(tz))}
      />

      <CreateSessionFab
        tz={tz}
        hidden={offline || (view === "day" && timelineState !== "ready")}
      />

      <SessionDetailSheet ref={sessionDetailSheetRef} tz={tz} />
      <BlockActionsSheet
        ref={blockActionsSheetRef}
        onReschedule={handleRequestReschedule}
        onSessionBefore={handleSessionBefore}
      />
      <RescheduleSheet
        ref={rescheduleSheetRef}
        tz={tz}
        onConfirm={handleRescheduleConfirm}
        onMoved={handleMoved}
        onRequestScopedUpdate={handleRequestScopedUpdate}
      />
      <UpdateRecurringSheet ref={updateScopeSheetRef} />
      {searchOpen ? <SessionSearchView onClose={closeSearch} /> : null}
    </View>
  );
}
