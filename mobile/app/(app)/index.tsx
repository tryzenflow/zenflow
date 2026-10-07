import { NextUpPill } from "@/components/calendar/next-up-pill";
import type { DayStatus } from "@/lib/day-status";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { slotPick, updateSession } from "@/api/tasks";
import {
  showAlternativePickToast,
  showBulkPickToast,
  showSeriesAlternativesPrompt,
  showSeriesPickToast,
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
import { TodayButton } from "@/components/calendar/today-button";
import {
  WeekHeader,
  type WeekHeaderHandle,
} from "@/components/calendar/week-header";
import {
  WeekPager,
  type WeekPagerHandle,
} from "@/components/calendar/week-pager";
import { NotificationBell } from "@/components/notification-bell";
import { GettingStarted } from "@/components/checklist/getting-started";
import { CreateSessionFab } from "@/components/tasks/create-task-fab";
import { completeStep } from "@/hooks/use-checklist";
import { useSpotlight } from "@/hooks/use-spotlight";
import { useUserStore } from "@/hooks/use-user-store";
import { findNearestTaskDate } from "@/lib/nearest-task-date";
import { getCachedDaySessions } from "@/lib/session-cache";
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
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { dateKey } from "@/lib/week-date-math";
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

/**
 * Calendar screen (the app's home tab) — the week view. Day view was folded
 * into this in favour of one paginated day-at-a-time timeline with a sticky
 * 7-day chip strip; there is no separate Day route.
 *
 * `focusedDate` is the committed focus — it drives the WeekHeader title/range
 * and highlights, and the pager aligns itself to it. Swipes that settle on an
 * edge day slide the whole week, and chip taps re-center the pager; both flow
 * back through this one state.
 */
export default function WeekScreen() {
  useLanguage();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const { date: dateParam, flash: flashParam } = useLocalSearchParams<{
    date?: string;
    flash?: string;
  }>();

  // Seeds from the optional `date` query param (ISO instant) so another screen
  // can deep-link into a specific day. `zonedDate` keeps the user-tz wall clock
  // in the local fields, never a bare `new Date()`.
  const [focusedDate, setFocusedDate] = useState(() =>
    dateParam ? zonedDate(dateParam, tz) : zonedNow(tz),
  );
  // What the header actually prints. Tracks the finger during a swipe (the
  // pager reports the centred day per whole-page crossing via
  // `onVisibleDateChange`), then reconciles to `focusedDate` on settle. Same
  // split as Month View's `monthDate` / `visibleMonth`.
  const [visibleDate, setVisibleDate] = useState(focusedDate);
  // A committed focus change (swipe settle, chip tap, deep link) moves both.
  const commitFocusedDate = useCallback((day: Date) => {
    setFocusedDate(day);
    setVisibleDate(day);
  }, []);
  // The user picked a day (chip tap or swipe) — unlike `commitFocusedDate`
  // alone, which a deep link / post-create teleport also calls.
  const handleUserSwitchDay = useCallback(
    (day: Date) => {
      completeStep("switch-day");
      commitFocusedDate(day);
    },
    [commitFocusedDate],
  );
  const handleVisibleDateChange = useCallback((day: Date) => {
    setVisibleDate((cur) => (dateKey(cur) === dateKey(day) ? cur : day));
  }, []);
  // Global refetch tick — bumped on every screen focus so *every* mounted day
  // re-syncs (a task created/edited on another screen shows up the moment we
  // return, no manual pull-to-refresh). Same pattern as Month View.
  const [focusTick, setFocusTick] = useState(0);
  // Load state of the focused page, reported up by the pager — gates the FAB.
  const [timelineState, setTimelineState] = useState<TimelineState>("loading");
  const [dayStatus, setDayStatus] = useState<DayStatus>({ kind: "none" });
  // Session id to pulse on the focused day — set by a create/edit teleport
  // (`?flash=` param) or a cross-day drag drop, cleared after the entrance.
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

  // Getting-started "move a task" (and "block actions") needs a task to point
  // at. If the focused day is empty, hop to the nearest day that has one.
  const spotlightStep = useSpotlight((s) => s.step);
  useEffect(() => {
    if (spotlightStep !== "move-task" && spotlightStep !== "block-actions") {
      return;
    }
    if (timelineState !== "ready") return;
    const cached = getCachedDaySessions(dateKey(focusedDate));
    if (!cached || cached.length > 0) return;
    let cancelled = false;
    findNearestTaskDate(focusedDate, tz).then((day) => {
      if (!cancelled && day) commitFocusedDate(day);
    });
    return () => {
      cancelled = true;
    };
  }, [spotlightStep, timelineState, focusedDate, tz, commitFocusedDate]);

  const tabBarOverlay = useTabBarOverlayHeight();

  // Per-day distinct session types for the visible week, for the header's
  // dot row — see `use-week-day-types.ts`.
  const dayTypes = useWeekDayTypes(visibleDate, tz, focusTick);

  // Strip offsets shared by the header and the pager so their week transitions
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

  // A divergent create/edit landed on the week view (`?date=`/`?flash=` params
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

  // A `sessionCount > 1` create / redistribute landed on the week view with
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
      // sheet is presented over the week view, never the modal form.
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
      router.push(`/task/${encodeURIComponent(taskId)}/edit` as Href);
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
    completeStep("block-actions");
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
      router.push({
        pathname: "/task/new",
        params: {
          deadline: start,
          sessions: String(sessions),
          title: t("Prepare for {title}", { title: session.title }),
        },
      } as Href);
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
      await updateSession(id, {
        scheduledStartTime: startISO,
        durationMinutes,
        scope,
        skipConflicting,
      });
    },
    [],
  );

  // A drag/reschedule that targets a session belonging to a series routes
  // through this scope-confirmation sheet before the caller (`RescheduleSheet`
  // or `WeekPager` → `DayTimeline`) commits.
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

  return (
    <View className="flex-1 bg-background">
      <NotificationBell />
      <GettingStarted />
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

      <View className="flex-1" style={{ paddingBottom: tabBarOverlay }}>
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
          onStatusChange={setDayStatus}
          onRequestReschedule={handleRequestReschedule}
          onRequestBlockMenu={handleRequestBlockMenu}
          onRequestScopedUpdate={handleRequestScopedUpdate}
          onRequestSlotPick={handleRequestSlotPick}
          flashSessionId={flashId}
        />
        <NextUpPill
          status={dayStatus}
          tz={tz}
          onOpenSession={handleSessionPress}
        />
      </View>

      <TodayButton
        visible={dateKey(visibleDate) !== dateKey(zonedNow(tz))}
        onPress={() => commitFocusedDate(zonedNow(tz))}
      />

      {timelineState === "ready" && <CreateSessionFab tz={tz} />}

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
    </View>
  );
}
