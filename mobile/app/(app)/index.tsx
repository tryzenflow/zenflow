import { TodayCard } from "@/components/calendar/today-card";
import { navigateOnce } from "@/lib/nav";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { slotPick, updateSession } from "@/api/tasks";
import {
  showAlternativePickToast,
  showBulkPickToast,
  showSeriesAlternativesPrompt,
  showSeriesPickToast,
  showSkippedToast,
} from "@/lib/task-toasts";
import type { TimelineState } from "@/components/calendar/day-timeline";
import {
  RescheduleSheet,
  type RescheduleSheetHandle,
} from "@/components/calendar/reschedule-sheet";
import {
  SeriesSlotPickSheet,
  type SeriesSlotPickSheetHandle,
} from "@/components/calendar/series-slot-pick-sheet";
import {
  type PendingSessionUpdate,
  type UpdateRecurringScope,
  UpdateRecurringSheet,
  type UpdateRecurringSheetHandle,
} from "@/components/calendar/update-recurring-sheet";
import {
  BlockActionsSheet,
  type BlockActionsSheetHandle,
} from "@/components/calendar/block-actions-sheet";
import { CalendarHeader } from "@/components/calendar/calendar-header";
import { MonthView } from "@/components/calendar/month-view";
import {
  SessionSearchSheet,
  type SessionSearchSheetHandle,
} from "@/components/calendar/session-search-sheet";
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
import {
  type PendingSlotPick,
  takePendingSlotPick,
} from "@/lib/pending-slot-pick";
import {
  type DivergentSitting,
  type SlotPickChoice,
  type SlotPickResult,
  singleSitting,
} from "@/lib/series-alternatives";
import { dateKey, weekStart } from "@/lib/week-date-math";
import { monthLabel } from "@/lib/month-date-math";
import { zonedDate, zonedNow } from "@zenflow/core";
import type { Session, SlotPickResponse, UpdateScope } from "@zenflow/shared";
import { differenceInCalendarDays } from "date-fns";
import {
  type Href,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
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
  const seriesSlotPickSheetRef = useRef<SeriesSlotPickSheetHandle>(null);
  const searchSheetRef = useRef<SessionSearchSheetHandle>(null);

  // Shared tail of a divergent pick (reschedule or create/edit hand-off):
  // re-seed onto the chosen slot's day, force every mounted day to revalidate
  // (so the block shows in its new place and clears from the old), and pulse
  // it. Jumping to the chosen day also fixes a pre-existing case where the
  // alternative sat off the focused day and the flash pulsed off-screen.
  const applySlotPickChoice = useCallback(
    (
      session: Session,
      primarySlot: string,
      alternativeSlot: string,
      chose: "primary" | "alternative",
    ) => {
      const chosenSlot =
        chose === "alternative" ? alternativeSlot : primarySlot;
      commitFocusedDate(zonedDate(chosenSlot, tz));
      setFocusTick((t) => t + 1);
      armFlash(session.id);
      if (chose === "alternative") {
        showAlternativePickToast(toast, alternativeSlot, tz);
      }
    },
    [tz, commitFocusedDate, armFlash, toast],
  );

  // One sheet for every divergent pick — a plain task is a one-sitting list.
  // **Confirm** / "Use all alternatives" send the whole batch at once: each
  // `slotPick` in turn (a sitting whose alternative clashes with a sibling is
  // refused with a 409 and reported in `failed`, the rest still land), one
  // summary toast, one refetch. `onApplied` runs for the sittings that landed.
  const openSlotPickSheet = useCallback(
    ({
      title,
      sittings,
      tz: pickTz,
      onApplied,
    }: {
      title: string;
      sittings: DivergentSitting[];
      tz: string;
      onApplied?: (applied: SlotPickChoice[]) => void | Promise<void>;
    }) => {
      const byId = new Map(sittings.map((s) => [s.session.id, s]));
      const series = (sittings[0]?.total ?? 1) > 1;
      seriesSlotPickSheetRef.current?.open({
        title,
        sittings,
        tz: pickTz,
        onConfirm: async (choices) => {
          const appliedIds: string[] = [];
          const failed: SlotPickResult["failed"] = [];
          const responses = new Map<string, SlotPickResponse>();
          for (const choice of choices) {
            try {
              const sitting = byId.get(choice.sittingId);
              if (!sitting) throw new Error(t("Unknown sitting"));
              responses.set(
                choice.sittingId,
                await slotPick(choice.sittingId, {
                  slotProposalId: sitting.slotProposalId,
                  chose: choice.chose,
                }),
              );
              appliedIds.push(choice.sittingId);
            } catch (error) {
              failed.push({ id: choice.sittingId, error });
            }
          }
          const applied = choices.filter((c) => appliedIds.includes(c.sittingId));
          if (series) {
            if (choices.length > 1) {
              showBulkPickToast(toast, applied.length, failed.length);
            } else {
              const res = responses.get(choices[0].sittingId);
              if (res) showSeriesPickToast(toast, res, pickTz);
            }
          }
          if (applied.length > 0) await onApplied?.(applied);
          // Deliberately not `commitFocusedDate`/`armFlash` for a series: there
          // the jump would yank the view from under the cards still to review.
          // `notifySessionsMutated()` inside `slotPick` already revalidates
          // every mounted day, so one refetch tick is enough.
          setFocusTick((t) => t + 1);
          return { appliedIds, failed };
        },
      });
    },
    [toast],
  );

  // Handle divergent slot pick from drag reschedule — show picker for primary vs alternative
  const handleRequestSlotPick = useCallback(
    (
      session: Session,
      primarySlot: string,
      alternativeSlot: string,
      slotProposalId: string,
      onPick: (chose: "primary" | "alternative") => Promise<void>,
    ) => {
      openSlotPickSheet({
        title: session.title,
        sittings: [
          singleSitting(session, { slotProposalId, primarySlot, alternativeSlot }),
        ],
        tz,
        onApplied: async ([{ chose }]) => {
          await onPick(chose);
          applySlotPickChoice(session, primarySlot, alternativeSlot, chose);
        },
      });
    },
    [applySlotPickChoice, openSlotPickSheet, tz],
  );

  // A divergent create/edit landed on the calendar (`?date=`/`?flash=` params
  // already focused it and pulsed the block) — present the same sheet over it.
  const handlePendingSlotPick = useCallback(
    (pending: Extract<PendingSlotPick, { kind: "single" }>) => {
      openSlotPickSheet({
        title: pending.session.title,
        sittings: [
          singleSitting(pending.session, {
            slotProposalId: pending.slotProposalId,
            primarySlot: pending.primarySlot,
            alternativeSlot: pending.alternativeSlot,
          }),
        ],
        tz: pending.tz,
        onApplied: ([{ chose }]) =>
          applySlotPickChoice(
            pending.session,
            pending.primarySlot,
            pending.alternativeSlot,
            chose,
          ),
      });
    },
    [applySlotPickChoice, openSlotPickSheet],
  );

  // A `sessionCount > 1` create / redistribute landed on the calendar with
  // divergent sittings (#59). Show the dismissible prompt; opening it presents
  // ONLY those sittings, each with its already-applied primary pre-selected.
  const handlePendingSeriesSlotPick = useCallback(
    (pending: Extract<PendingSlotPick, { kind: "series" }>) => {
      showSeriesAlternativesPrompt(
        toast,
        pending.sittings.length,
        pending.sittings[0]?.total ?? pending.sittings.length,
        () =>
          openSlotPickSheet({
            title: pending.title,
            sittings: pending.sittings,
            tz: pending.tz,
          }),
      );
    },
    [openSlotPickSheet, toast],
  );

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
      // A divergent create/edit handed off its primary-vs-alternative pick
      // (`setPendingSlotPick` in task/new|edit) — consume it here so the
      // sheet is presented over the calendar, never the modal form.
      const pending = takePendingSlotPick();
      // A `sessionCount > 1` series (#59) carries its per-sitting divergence on
      // `sessions[]` and arrives here too, as a different shape.
      if (pending?.kind === "single") handlePendingSlotPick(pending);
      else if (pending?.kind === "series") handlePendingSeriesSlotPick(pending);
    }, [handlePendingSlotPick, handlePendingSeriesSlotPick]),
  );

  // A fresh deep-link (`date` param changed) re-seeds the focus.
  const lastParamRef = useRef(dateParam);
  useEffect(() => {
    if (dateParam && dateParam !== lastParamRef.current) {
      lastParamRef.current = dateParam;
      commitFocusedDate(zonedDate(dateParam, tz));
    }
  }, [dateParam, tz, commitFocusedDate]);

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

  const handleSessionPress = useCallback(
    (taskId: string) => {
      // A recurring occurrence id ("<seriesId>::<startISO>") must be encoded to
      // survive the route path.
      navigateOnce(() =>
        router.push(`/task/${encodeURIComponent(taskId)}/edit` as Href),
      );
    },
    [router],
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

  // A drag/reschedule that targets a session belonging to a series routes
  // through this scope-confirmation sheet before the caller (`RescheduleSheet`
  // or `WeekPager` → `DayTimeline`, or `WeekGrid`) commits.
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

  return (
    <View className="flex-1 bg-background">
      <CalendarHeader
        view={view}
        onViewChange={handleViewChange}
        offlineKey={`${view}:${dateKey(focusedDate)}`}
        onSearch={() => searchSheetRef.current?.open()}
      />

      {view === "day" ? (
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
              onRequestSlotPick={handleRequestSlotPick}
              flashSessionId={flashId}
            />
          </View>
        </>
      ) : null}

      {view === "week" ? (
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
          onRequestSlotPick={handleRequestSlotPick}
        />
      ) : null}

      {view === "month" ? (
        <MonthView
          date={focusedDate}
          onDateChange={handleMonthDateChange}
          tz={tz}
          reloadToken={focusTick}
          onOpenDay={openDayView}
        />
      ) : null}

      <TodayButton
        visible={!isAtToday}
        onPress={() => commitFocusedDate(zonedNow(tz))}
      />

      {!offline && (view !== "day" || timelineState === "ready") && (
        <CreateSessionFab tz={tz} />
      )}

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
      <SeriesSlotPickSheet ref={seriesSlotPickSheetRef} tz={tz} />
      <SessionSearchSheet ref={searchSheetRef} />
    </View>
  );
}
