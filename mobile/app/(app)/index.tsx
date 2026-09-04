import { updateSession } from "@/api/tasks";
import type { TimelineState } from "@/components/calendar/day-timeline";
import {
  RescheduleSheet,
  type RescheduleSheetHandle,
} from "@/components/calendar/reschedule-sheet";
import {
  WeekHeader,
  type WeekHeaderHandle,
} from "@/components/calendar/week-header";
import {
  WeekPager,
  type WeekPagerHandle,
} from "@/components/calendar/week-pager";
import { CreateSessionFab } from "@/components/tasks/create-task-fab";
import { useUserStore } from "@/hooks/use-user-store";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { dateKey } from "@/lib/week-date-math";
import { useFocusEffect } from "@react-navigation/native";
import { zonedDate, zonedNow } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSharedValue } from "react-native-reanimated";

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
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
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
  const handleVisibleDateChange = useCallback((day: Date) => {
    setVisibleDate((cur) => (dateKey(cur) === dateKey(day) ? cur : day));
  }, []);
  // Global refetch tick — bumped on every screen focus so *every* mounted day
  // re-syncs (a task created/edited on another screen shows up the moment we
  // return, no manual pull-to-refresh). Same pattern as Month View.
  const [focusTick, setFocusTick] = useState(0);
  // Load state of the focused page, reported up by the pager — gates the FAB.
  const [timelineState, setTimelineState] = useState<TimelineState>("loading");
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

  const tabBarOverlay = useTabBarOverlayHeight();

  // Strip offsets shared by the header and the pager so their week transitions
  // move in lockstep. Rest = `-width` (focused page / middle week block
  // centered). Owned here — the nearest common parent.
  const { width } = useWindowDimensions();
  const progressSV = useSharedValue(-width);
  const headerStripSV = useSharedValue(-width);
  const pagerRef = useRef<WeekPagerHandle>(null);
  const headerRef = useRef<WeekHeaderHandle>(null);
  const rescheduleSheetRef = useRef<RescheduleSheetHandle>(null);

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

  // Long-press a block → open the "Move to…" sheet for that session.
  const handleRequestReschedule = useCallback((session: Session) => {
    rescheduleSheetRef.current?.open(session);
  }, []);

  // The sheet's confirm — a single `PATCH /sessions/:id` (move + resize).
  const handleRescheduleConfirm = useCallback(
    async (id: string, startISO: string, durationMinutes: number) => {
      await updateSession(id, {
        scheduledStartTime: startISO,
        durationMinutes,
      });
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
      <WeekHeader
        ref={headerRef}
        focusedDate={focusedDate}
        displayDate={visibleDate}
        tz={tz}
        onSelectDay={commitFocusedDate}
        progressSV={progressSV}
        headerStripSV={headerStripSV}
        onWeekDragBegin={handleWeekDragBegin}
        onWeekDragSettle={handleWeekDragSettle}
        onWeekDragAbort={handleWeekDragAbort}
      />

      <View className="flex-1" style={{ paddingBottom: tabBarOverlay }}>
        <WeekPager
          ref={pagerRef}
          focusedDate={focusedDate}
          onFocusedDateChange={commitFocusedDate}
          onVisibleDateChange={handleVisibleDateChange}
          focusTick={focusTick}
          onSessionPress={handleSessionPress}
          onLongPress={handleLongPress}
          progressSV={progressSV}
          headerStripSV={headerStripSV}
          onWeekSlideStart={handleWeekSlideStart}
          onWeekSlideEnd={handleWeekSlideEnd}
          onActiveStateChange={setTimelineState}
          onRequestReschedule={handleRequestReschedule}
          flashSessionId={flashId}
        />
      </View>

      {timelineState === "ready" && <CreateSessionFab tz={tz} />}

      <RescheduleSheet
        ref={rescheduleSheetRef}
        tz={tz}
        onConfirm={handleRescheduleConfirm}
        onMoved={handleMoved}
      />
    </View>
  );
}
