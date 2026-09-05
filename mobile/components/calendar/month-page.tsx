import { listSessions, updateSession } from "@/api/tasks";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import {
  dateKey,
  getMonthGridDays,
  groupSessionsByDate,
} from "@/lib/month-date-math";
import { isPastDeadlineDrop } from "@/lib/overdue";
import { SESSION_TYPE_META } from "@/lib/session-type";
import {
  MONTH_PILL_CLASSES,
  MONTH_PILL_TEXT_CLASSES,
  deriveState,
} from "@/lib/task-card";
import { cn } from "@/lib/utils";
import { zonedDate, zonedNow, zonedWallClockToUtc } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { CELL_HEIGHT } from "./month-cell";
import { MonthGrid, MonthGridSkeleton } from "./month-grid";
import { sessionTypeIcon } from "./session-type-badge";

interface DragState {
  task: Session;
  fromKey: string;
}

/**
 * The drag callbacks a `MonthPage` hands to whoever opens its day sheet, so a
 * long-press-drag started on a `SessionListSheet` row lands in the *same* page's
 * drag machinery (geometry, ghost, drop-target highlight, reschedule) that an
 * in-grid pill drag uses.
 *
 * Passing it out through `onOpenDay`/`onOpenOverflow` rather than reaching for
 * the active page through a ref in `month.tsx` keeps the routing correct by
 * construction: only the page the user can actually see opens a sheet, so the
 * handle the sheet holds is always the page whose grid is on screen.
 *
 * The object identity is stable for the page's whole lifetime (see
 * `dragHandle` below) — the sheet captures it once at open time and may fire
 * `end` many seconds later, so the methods must not close over a stale render.
 */
export interface MonthDragHandle {
  start: (
    task: Session,
    day: Date,
    absoluteX: number,
    absoluteY: number,
  ) => void;
  update: (absoluteX: number, absoluteY: number) => void;
  end: (absoluteX: number, absoluteY: number) => void;
  cancel: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return (
    (isAxiosError(error) &&
      (error.response?.data as { message?: string } | undefined)?.message) ||
    fallback
  );
}

interface MonthPageProps {
  monthDate: Date;
  tz: string;
  /** Bumped by the caller (`app/(app)/month.tsx`) whenever this page's data
   * should be refetched — after create/edit/delete/optimize, mirroring Day
   * View's `useFocusEffect` refetch. */
  reloadToken: number;
  /** True only for the page the outer header currently shows. Off-screen
   * prev/next pages (pre-fetched by `MonthPager` for swipe) still fetch, but
   * suppress their own error toast — see the call site's comment for why. */
  isActive: boolean;
  /** Fired when a pill drag starts/ends, so the screen can freeze the outer
   * `MonthPager` — otherwise the horizontal swipe-to-next-month scroll
   * competes with the drag and usually wins. */
  onDragActiveChange: (active: boolean) => void;
  onOpenDay: (day: Date, tasks: Session[], drag: MonthDragHandle) => void;
  onOpenOverflow: (day: Date, tasks: Session[], drag: MonthDragHandle) => void;
}

/**
 * One month's worth of the paginated grid: owns its own fetch (`GET
 * /tasks?view=month`, which already pads its range to whole Monday-first
 * weeks server-side — see `backend/src/scheduler/utils/horizon.ts`'s
 * `displayDayRange` — so adjacent-month days come back populated too, no
 * client-side padding-fetch needed), the in-month long-press-drag reschedule
 * gesture (day → day, from the grid or the day sheet), and its own loading
 * skeleton. Moving a task to a *different* month is the "Move to…" sheet's job
 * (`reschedule-sheet.tsx`), reached from the day sheet's per-row "Move" button —
 * there is no edge-drag cross-month advance. Each page mounted by the outer
 * `MonthPager`/`month-pager.tsx` fetches independently.
 */
export function MonthPage({
  monthDate,
  tz,
  reloadToken,
  isActive,
  onDragActiveChange,
  onOpenDay,
  onOpenOverflow,
}: MonthPageProps) {
  const { toast, confirm } = useToast();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  // A day key to pulse for a moment right after a drop lands on it.
  const [justDroppedKey, setJustDroppedKey] = useState<string | null>(null);
  const justDroppedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // The drag ghost follows the finger on the UI thread via shared values —
  // NOT per-frame React state. `setGhostPos` on every `onUpdate` frame was
  // re-rendering `MonthPage` → `MonthGrid` → all ≤42 `MonthCell`s each frame,
  // which is what made the Month drag lag.
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostVisible = useSharedValue(0);
  const pageOffX = useSharedValue(0);
  const pageOffY = useSharedValue(0);

  const pageRef = useRef<View>(null);
  const gridRef = useRef<View>(null);
  const gridRectRef = useRef({ x: 0, y: 0, width: 0, rows: 0 });
  const lastHighlightRef = useRef<string | null>(null);
  // The dragged pill's origin day key, read inside the pan callbacks — a ref
  // rather than `dragging.fromKey` so `onUpdate` can't observe a stale
  // pre-`setDragging` render.
  const dragFromKeyRef = useRef<string | null>(null);

  const days = useMemo(() => getMonthGridDays(monthDate), [monthDate]);
  // Memoized so `MonthGrid` (now `React.memo`) sees a stable `today` prop
  // across the per-cell-crossing `highlightedKey` re-renders of an in-month
  // drag — otherwise a fresh `zonedNow(tz)` each render defeats the memo.
  const today = useMemo(() => zonedNow(tz), [tz]);

  // Read via a ref inside `refetch` rather than a `useCallback` dep — toggling
  // `isActive` (the pager sliding this page in/out of the "center" slot)
  // shouldn't itself trigger a new fetch, only change whether a failure
  // surfaces a toast.
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const refetch = useCallback(async () => {
    try {
      // No status filter (unlike Day View's `listSessions("day", …, "PENDING")`)
      // — the month grid shows completed pills too (line-through), matching
      // `mockups/month-view.html` and the un-filtered fetch
      // `frontend/src/components/calendar/layout.tsx` already does.
      const res = await listSessions("month", monthDate);
      setSessions(res.sessions);
    } catch (error) {
      setSessions((cur) => cur ?? []);
      if (isActiveRef.current) {
        toast(
          errorMessage(error, "Couldn't load this month's tasks"),
          "destructive",
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate]);

  useEffect(() => {
    refetch();
  }, [refetch, reloadToken]);

  const tasksByDate = useMemo(
    () => groupSessionsByDate(sessions ?? [], tz),
    [sessions, tz],
  );

  /**
   * Re-reads this page's and its grid's position in *window* coordinates.
   *
   * This can't be done once at layout time. A page lays out while it still
   * sits at its slot inside the outer `MonthPager`'s horizontally-scrolled
   * `FlatList` content — the center page's `onLayout` fires when it is one
   * screen-width to the right, before the pager's forced
   * `scrollToOffset({ offset: width })` recenters it — and `onLayout` does
   * NOT fire again when a scroll moves it. So the cached offsets described a
   * position the page no longer occupies: the drag ghost (`absoluteX -
   * pageOffset.x`) was drawn a full screen-width off to the left, which is
   * why a picked-up task vanished instead of following the finger, and
   * `targetDayForPoint` hit-tested against the wrong columns.
   *
   * Called on layout, whenever this page becomes the active one (i.e. after
   * a swipe settles), and again at drag start.
   */
  const measureGeometry = useCallback(() => {
    pageRef.current?.measureInWindow((x, y) => {
      pageOffX.value = x;
      pageOffY.value = y;
    });
    gridRef.current?.measureInWindow((x, y, width) => {
      gridRectRef.current = { x, y, width, rows: Math.ceil(days.length / 7) };
    });
  }, [days.length, pageOffX, pageOffY]);

  useEffect(() => {
    if (!isActive) return;
    // A frame late, so the pager's recentering scroll has settled first.
    const id = requestAnimationFrame(measureGeometry);
    return () => cancelAnimationFrame(id);
  }, [isActive, measureGeometry]);

  useEffect(
    () => () => {
      if (justDroppedTimerRef.current)
        clearTimeout(justDroppedTimerRef.current);
    },
    [],
  );

  const ghostStyle = useAnimatedStyle(() => ({
    position: "absolute",
    left: ghostX.value - pageOffX.value - 48,
    top: ghostY.value - pageOffY.value - 34,
    width: 96,
    opacity: ghostVisible.value,
    // The mockup's `scale-[1.06] -rotate-[2.5deg]` "picked up" tilt.
    transform: [{ scale: 1.06 }, { rotate: "-2.5deg" }],
  }));

  function targetDayForPoint(
    absoluteX: number,
    absoluteY: number,
  ): Date | null {
    const { x, y, width, rows } = gridRectRef.current;
    if (width === 0) return null;
    const cellWidth = width / 7;
    const col = Math.floor((absoluteX - x) / cellWidth);
    const row = Math.floor((absoluteY - y) / CELL_HEIGHT);
    if (col < 0 || col > 6 || row < 0 || row >= rows) return null;
    return days[row * 7 + col] ?? null;
  }

  function handlePillDragStart(
    task: Session,
    day: Date,
    absoluteX: number,
    absoluteY: number,
  ) {
    const key = dateKey(day);
    // The page may have been scrolled since its last measurement.
    measureGeometry();
    setDragging({ task, fromKey: key });
    dragFromKeyRef.current = key;
    onDragActiveChange(true);
    // Seed the ghost at the finger straight away. The origin pill hides the
    // moment the long-press activates (`draggingSessionId` → `MonthPill`'s
    // spacer), so without an initial position the task is simply *gone* from
    // the grid until the first `onUpdate` frame fires.
    ghostX.value = absoluteX;
    ghostY.value = absoluteY;
    ghostVisible.value = 1;
    // The day the drag started on is NOT a drop target — dropping back on it
    // is a no-op (`handlePillDragEnd` returns early on `targetKey ===
    // fromKey`), so highlighting it just reads as "this cell is armed".
    lastHighlightRef.current = null;
    setHighlightedKey(null);
  }

  function handlePillDragUpdate(absoluteX: number, absoluteY: number) {
    ghostX.value = absoluteX;
    ghostY.value = absoluteY;

    const target = targetDayForPoint(absoluteX, absoluteY);
    const targetKey = target ? dateKey(target) : null;
    // Any grid cell — including the padded leading/trailing week — is a valid
    // in-place drop target; a screen edge does nothing now (moving to another
    // month is the "Move to…" sheet). `lastHighlightRef` gates the state write
    // + haptic so they fire only on an actual cell change, not every frame.
    const key =
      target && targetKey !== dragFromKeyRef.current ? targetKey : null;
    if (key !== lastHighlightRef.current) {
      lastHighlightRef.current = key;
      setHighlightedKey(key);
      Haptics.selectionAsync().catch(() => {});
    }
  }

  /** Clears every bit of drag state. Called from both `onEnd` (a completed
   * drop) and `onFinalize` (which also covers a *cancelled* pan) — without
   * the latter, a gesture the pager stole mid-drag left `dragging` set
   * forever, so the picked-up pill stayed hidden and the task looked like it
   * had disappeared from the grid. */
  function resetDragState() {
    setDragging(null);
    setHighlightedKey(null);
    ghostVisible.value = 0;
    lastHighlightRef.current = null;
    dragFromKeyRef.current = null;
    onDragActiveChange(false);
  }

  function pulseDropCell(key: string) {
    setJustDroppedKey(key);
    if (justDroppedTimerRef.current) clearTimeout(justDroppedTimerRef.current);
    justDroppedTimerRef.current = setTimeout(
      () => setJustDroppedKey(null),
      700,
    );
  }

  async function handlePillDragEnd(absoluteX: number, absoluteY: number) {
    const drag = dragging;
    const target = targetDayForPoint(absoluteX, absoluteY);
    resetDragState();

    if (!drag) return;
    const original = drag.task;
    if (!original.scheduledStartTime) return;
    if (!target) return;

    // Keep the task's wall-clock time-of-day; move the *day* — mirrors
    // `frontend/src/components/calendar/month-view.tsx`'s `onDragEnd`. Each
    // recurring occurrence is already its own materialized `Session` row
    // (CLAUDE.md §4) and `PATCH /tasks/:id` only ever targets a single task id,
    // so issue #21's "does drag need scope: 'one' | 'following'?" open question
    // doesn't apply — the endpoint always acts on exactly the dragged occurrence.
    // This drag only ever moves within the visible month's grid (incl. its
    // padded leading/trailing week); a different month is the "Move to…" sheet.
    const targetKey = dateKey(target);
    if (targetKey === drag.fromKey) return; // no-op drop, same day
    const wall = zonedDate(original.scheduledStartTime, tz);
    const [y, m, d] = targetKey.split("-").map(Number);
    wall.setFullYear(y, m - 1, d);
    const newStartISO = zonedWallClockToUtc(wall, tz).toISOString();

    const landedKey = dateKey(zonedDate(newStartISO, tz));

    const applyMove = async () => {
      pulseDropCell(landedKey);
      const prevSessions = sessions;
      setSessions((cur) =>
        (cur ?? []).map((t) =>
          t.id === original.id ? { ...t, scheduledStartTime: newStartISO } : t,
        ),
      );

      try {
        const updated = await updateSession(original.id, {
          scheduledStartTime: newStartISO,
        });
        setSessions((cur) =>
          (cur ?? []).map((t) => (t.id === original.id ? updated : t)),
        );
      } catch (error) {
        setSessions(prevSessions ?? []); // rollback the optimistic move
        toast(errorMessage(error, "Couldn't reschedule task"), "destructive");
      }
    };

    // Dropping a session past its own deadline is almost always a slip — ask
    // before the API call. `resetDragState` already ran, so a cancel just
    // leaves the pill where it was.
    if (isPastDeadlineDrop(newStartISO, original.deadline)) {
      confirm("Schedule after the deadline?", {
        description: "This session will start past its due time.",
        confirmLabel: "Schedule anyway",
        cancelLabel: "Cancel",
        onConfirm: () => {
          void applyMove();
        },
      });
      return;
    }

    await applyMove();
  }

  // Same "read the callbacks out of a ref at fire time" pattern `MonthPill`
  // uses, for the same reason in a longer-lived form: `SessionListSheet` captures
  // this handle once, when the sheet opens, and only calls `end` after the
  // drop — by which point `handlePillDragEnd`'s closure over `dragging` and
  // `tasks` must be the *current* one, not the render the sheet opened on. A
  // handle built fresh each render would have been captured pre-drag, so its
  // `end` would still see `dragging === null` and silently skip the
  // reschedule.
  const latestDrag = useRef({
    start: handlePillDragStart,
    update: handlePillDragUpdate,
    end: handlePillDragEnd,
    cancel: resetDragState,
  });
  latestDrag.current = {
    start: handlePillDragStart,
    update: handlePillDragUpdate,
    end: handlePillDragEnd,
    cancel: resetDragState,
  };

  const dragHandle = useMemo<MonthDragHandle>(
    () => ({
      start: (task, day, x, y) => latestDrag.current.start(task, day, x, y),
      update: (x, y) => latestDrag.current.update(x, y),
      end: (x, y) => latestDrag.current.end(x, y),
      cancel: () => latestDrag.current.cancel(),
    }),
    [],
  );

  const handleOpenDay = useCallback(
    (day: Date, daySessions: Session[]) =>
      onOpenDay(day, daySessions, dragHandle),
    [onOpenDay, dragHandle],
  );
  const handleOpenOverflow = useCallback(
    (day: Date, daySessions: Session[]) =>
      onOpenOverflow(day, daySessions, dragHandle),
    [onOpenOverflow, dragHandle],
  );

  const ghostSession = dragging?.task ?? null;
  const ghostState = ghostSession ? deriveState(ghostSession) : null;
  const GhostIcon = ghostSession ? sessionTypeIcon(ghostSession.type) : null;

  return (
    <View ref={pageRef} onLayout={measureGeometry} className="flex-1">
      {sessions === null ? (
        <MonthGridSkeleton />
      ) : (
        <MonthGrid
          ref={gridRef}
          monthDate={monthDate}
          days={days}
          today={today}
          tasksByDate={tasksByDate}
          highlightedKey={highlightedKey}
          draggingSessionId={dragging?.task.id ?? null}
          onPressDay={handleOpenDay}
          onPressOverflow={handleOpenOverflow}
          onGridLayout={measureGeometry}
          justDroppedKey={justDroppedKey}
        />
      )}

      {/* Drop-target highlight lives on `MonthCell` itself (`isDropTarget`);
          this floating pill is just the dragged copy following the finger —
          positioned on the UI thread from shared values. */}
      {ghostSession && ghostState && GhostIcon && (
        <Animated.View pointerEvents="none" style={ghostStyle}>
          <View
            className={cn(
              // Keeps the pills' `border-l-2` accent rather than the mockup's
              // all-round `border border-brand-orange/45`: RN has no
              // per-state border color in `MONTH_PILL_CLASSES` for the other
              // three sides, and an uncolored `border` there falls back to
              // black instead of inheriting.
              "flex-row items-center gap-1 rounded-md border-l-2 px-1.5 py-1 shadow-lg",
              MONTH_PILL_CLASSES[ghostState],
            )}
          >
            <GhostIcon
              size={10}
              className={SESSION_TYPE_META[ghostSession.type].textClass}
            />
            <Text
              numberOfLines={1}
              className={cn(
                "flex-1 text-[10px] font-semibold",
                MONTH_PILL_TEXT_CLASSES[ghostState],
              )}
            >
              {ghostSession.scheduledStartTime && (
                <Text className="text-[10px] font-normal text-muted-foreground">
                  {format(
                    zonedDate(ghostSession.scheduledStartTime, tz),
                    "H:mm",
                  )}{" "}
                </Text>
              )}
              {ghostSession.title}
            </Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}
