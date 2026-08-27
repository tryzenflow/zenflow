import { listSessions, updateSession } from "@/api/tasks";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import {
  dateKey,
  getMonthGridDays,
  groupSessionsByDate,
  isOutsideMonth,
} from "@/lib/month-date-math";
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
import { CELL_HEIGHT } from "./month-cell";
import { MonthGrid, MonthGridSkeleton } from "./month-grid";

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

interface GhostPosition {
  x: number;
  y: number;
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
  /** Reports how many of this month's tasks the scheduler placed past their
   * deadline, for the header's "N overdue" badge. Only the active page
   * reports, so the badge always describes the month on screen. */
  onOverdueCountChange: (count: number) => void;
  onOpenDay: (day: Date, tasks: Session[], drag: MonthDragHandle) => void;
  onOpenOverflow: (day: Date, tasks: Session[], drag: MonthDragHandle) => void;
}

/**
 * One month's worth of the paginated grid: owns its own fetch (`GET
 * /tasks?view=month`, which already pads its range to whole Monday-first
 * weeks server-side — see `backend/src/scheduler/utils/horizon.ts`'s
 * `displayDayRange` — so adjacent-month days come back populated too, no
 * client-side padding-fetch needed), the long-press-drag reschedule gesture,
 * and its own loading skeleton. Each page mounted by the outer
 * `MonthPager`/`month-pager.tsx` fetches independently.
 */
export function MonthPage({
  monthDate,
  tz,
  reloadToken,
  isActive,
  onDragActiveChange,
  onOverdueCountChange,
  onOpenDay,
  onOpenOverflow,
}: MonthPageProps) {
  const { toast } = useToast();
  const [tasks, setSessions] = useState<Session[] | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<GhostPosition | null>(null);

  const pageRef = useRef<View>(null);
  const gridRef = useRef<View>(null);
  const pageOffsetRef = useRef({ x: 0, y: 0 });
  const gridRectRef = useRef({ x: 0, y: 0, width: 0, rows: 0 });
  const lastHighlightRef = useRef<string | null>(null);
  // The dragged pill's origin day key, read inside the pan callbacks — a ref
  // rather than `dragging.fromKey` so `onUpdate` can't observe a stale
  // pre-`setDragging` render.
  const dragFromKeyRef = useRef<string | null>(null);

  const days = useMemo(() => getMonthGridDays(monthDate), [monthDate]);
  const today = zonedNow(tz);

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
    () => groupSessionsByDate(tasks ?? [], tz),
    [tasks, tz],
  );

  useEffect(() => {
    if (!isActive) return;
    // While this month is still loading, report 0 rather than leaving the
    // previous month's count on screen next to the new title.
    onOverdueCountChange(
      tasks ? tasks.filter((t) => deriveState(t) === "overdue").length : 0,
    );
  }, [isActive, tasks, onOverdueCountChange]);

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
      pageOffsetRef.current = { x, y };
    });
    gridRef.current?.measureInWindow((x, y, width) => {
      gridRectRef.current = { x, y, width, rows: Math.ceil(days.length / 7) };
    });
  }, [days.length]);

  useEffect(() => {
    if (!isActive) return;
    // A frame late, so the pager's recentering scroll has settled first.
    const id = requestAnimationFrame(measureGeometry);
    return () => cancelAnimationFrame(id);
  }, [isActive, measureGeometry]);

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
    setGhostPos({ x: absoluteX, y: absoluteY });
    // The day the drag started on is NOT a drop target — dropping back on it
    // is a no-op (`handlePillDragEnd` returns early on `targetKey ===
    // fromKey`), so highlighting it just reads as "this cell is armed".
    lastHighlightRef.current = null;
    setHighlightedKey(null);
  }

  function handlePillDragUpdate(absoluteX: number, absoluteY: number) {
    setGhostPos({ x: absoluteX, y: absoluteY });
    const target = targetDayForPoint(absoluteX, absoluteY);
    const targetKey = target ? dateKey(target) : null;
    const key =
      target &&
      !isOutsideMonth(target, monthDate) &&
      targetKey !== dragFromKeyRef.current
        ? targetKey
        : null;
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
    setGhostPos(null);
    lastHighlightRef.current = null;
    dragFromKeyRef.current = null;
    onDragActiveChange(false);
  }

  async function handlePillDragEnd(absoluteX: number, absoluteY: number) {
    const drag = dragging;
    const target = targetDayForPoint(absoluteX, absoluteY);
    resetDragState();

    if (!drag || !target) return;
    if (isOutsideMonth(target, monthDate)) return; // outside days aren't a valid drop target
    const targetKey = dateKey(target);
    if (targetKey === drag.fromKey) return; // no-op drop, same day it started on

    const original = drag.task;
    if (!original.scheduledStartTime) return;

    // Keep the task's wall-clock time-of-day, move it to the dropped day —
    // mirrors `frontend/src/components/calendar/month-view.tsx`'s
    // `onDragEnd`. Each recurring occurrence is already its own materialized
    // `Session` row (CLAUDE.md §4) and `PATCH /tasks/:id` only ever targets a
    // single task id — so issue #21's "does drag need scope: 'one' |
    // 'following'?" open question doesn't apply here; there's nothing to
    // scope, the endpoint always acts on exactly the dragged occurrence.
    const wall = zonedDate(original.scheduledStartTime, tz);
    const [y, m, d] = targetKey.split("-").map(Number);
    wall.setFullYear(y, m - 1, d);
    const newStart = zonedWallClockToUtc(wall, tz);

    const prevSessions = tasks;
    setSessions((cur) =>
      (cur ?? []).map((t) =>
        t.id === original.id
          ? { ...t, scheduledStartTime: newStart.toISOString() }
          : t,
      ),
    );

    try {
      const updated = await updateSession(original.id, {
        scheduledStartTime: newStart.toISOString(),
      });
      setSessions((cur) =>
        (cur ?? []).map((t) => (t.id === original.id ? updated : t)),
      );
    } catch (error) {
      setSessions(prevSessions ?? []); // rollback the optimistic move
      toast(errorMessage(error, "Couldn't reschedule task"), "destructive");
    }
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

  return (
    <View ref={pageRef} onLayout={measureGeometry} className="flex-1">
      {tasks === null ? (
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
          onPillDragStart={handlePillDragStart}
          onPillDragUpdate={handlePillDragUpdate}
          onPillDragEnd={handlePillDragEnd}
          onPillDragCancel={resetDragState}
          onGridLayout={measureGeometry}
        />
      )}

      {/* Drop-target highlight lives on `MonthCell` itself (`isDropTarget`);
          this floating pill is just the dragged copy following the finger. */}
      {ghostSession && ghostPos && ghostState && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: ghostPos.x - pageOffsetRef.current.x - 48,
            top: ghostPos.y - pageOffsetRef.current.y - 34,
            width: 96,
            // The mockup's `scale-[1.06] -rotate-[2.5deg]` "picked up" tilt.
            transform: [{ scale: 1.06 }, { rotate: "-2.5deg" }],
          }}
        >
          <View
            className={cn(
              // Keeps the pills' `border-l-2` accent rather than the mockup's
              // all-round `border border-brand-orange/45`: RN has no
              // per-state border color in `MONTH_PILL_CLASSES` for the other
              // three sides, and an uncolored `border` there falls back to
              // black instead of inheriting.
              "rounded-md border-l-2 px-1.5 py-1 shadow-lg",
              MONTH_PILL_CLASSES[ghostState],
            )}
          >
            <Text
              numberOfLines={1}
              className={cn(
                "text-[10px] font-semibold",
                MONTH_PILL_TEXT_CLASSES[ghostState],
              )}
            >
              {ghostSession.scheduledStartTime && (
                <Text className="font-mono text-[10px] font-normal text-muted-foreground">
                  {format(
                    zonedDate(ghostSession.scheduledStartTime, tz),
                    "H:mm",
                  )}{" "}
                </Text>
              )}
              {ghostSession.title}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
