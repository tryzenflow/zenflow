import { listTasks, rescheduleTask } from "@/api/tasks";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import {
  dateKey,
  getMonthGridDays,
  groupTasksByDate,
  isOutsideMonth,
} from "@/lib/month-date-math";
import {
  MONTH_PILL_CLASSES,
  MONTH_PILL_TEXT_CLASSES,
  deriveState,
} from "@/lib/task-card";
import { cn } from "@/lib/utils";
import { zonedDate, zonedNow, zonedWallClockToUtc } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { isAxiosError } from "axios";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { CELL_HEIGHT } from "./month-cell";
import { MonthGrid, MonthGridSkeleton } from "./month-grid";

interface DragState {
  task: Task;
  fromKey: string;
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
  onOpenDay: (day: Date) => void;
  onOpenOverflow: (day: Date, tasks: Task[]) => void;
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
  onOpenDay,
  onOpenOverflow,
}: MonthPageProps) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<GhostPosition | null>(null);

  const pageRef = useRef<View>(null);
  const gridRef = useRef<View>(null);
  const pageOffsetRef = useRef({ x: 0, y: 0 });
  const gridRectRef = useRef({ x: 0, y: 0, width: 0, rows: 0 });
  const lastHighlightRef = useRef<string | null>(null);

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
      // No status filter (unlike Day View's `listTasks("day", …, "PENDING")`)
      // — the month grid shows completed pills too (line-through), matching
      // `mockups/month-view.html` and the un-filtered fetch
      // `frontend/src/components/calendar/layout.tsx` already does.
      const res = await listTasks("month", monthDate);
      setTasks(res.tasks);
    } catch (error) {
      setTasks((cur) => cur ?? []);
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
    () => groupTasksByDate(tasks ?? [], tz),
    [tasks, tz],
  );

  function handlePageLayout() {
    pageRef.current?.measureInWindow((x, y) => {
      pageOffsetRef.current = { x, y };
    });
  }

  function handleGridLayout(_event: LayoutChangeEvent) {
    gridRef.current?.measureInWindow((x, y, width) => {
      gridRectRef.current = { x, y, width, rows: Math.ceil(days.length / 7) };
    });
  }

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

  function handlePillDragStart(task: Task, day: Date) {
    const key = dateKey(day);
    setDragging({ task, fromKey: key });
    lastHighlightRef.current = key;
    setHighlightedKey(key);
  }

  function handlePillDragUpdate(absoluteX: number, absoluteY: number) {
    setGhostPos({ x: absoluteX, y: absoluteY });
    const target = targetDayForPoint(absoluteX, absoluteY);
    const key =
      target && !isOutsideMonth(target, monthDate) ? dateKey(target) : null;
    if (key !== lastHighlightRef.current) {
      lastHighlightRef.current = key;
      setHighlightedKey(key);
      Haptics.selectionAsync().catch(() => {});
    }
  }

  async function handlePillDragEnd(absoluteX: number, absoluteY: number) {
    const drag = dragging;
    const target = targetDayForPoint(absoluteX, absoluteY);
    setDragging(null);
    setHighlightedKey(null);
    setGhostPos(null);
    lastHighlightRef.current = null;

    if (!drag || !target) return;
    if (isOutsideMonth(target, monthDate)) return; // outside days aren't a valid drop target
    const targetKey = dateKey(target);
    if (targetKey === drag.fromKey) return; // no-op drop, same day it started on

    const original = drag.task;
    if (!original.scheduledStartTime) return;

    // Keep the task's wall-clock time-of-day, move it to the dropped day —
    // mirrors `frontend/src/components/calendar/month-view.tsx`'s
    // `onDragEnd`. Each recurring occurrence is already its own materialized
    // `Task` row (CLAUDE.md §4) and `PATCH /tasks/:id/reschedule` only ever
    // targets a single task id (`api/tasks.ts`'s `rescheduleTask` has no
    // `scope` parameter) — so issue #21's "does drag need scope: 'one' |
    // 'following'?" open question doesn't apply here; there's nothing to
    // scope, the endpoint always acts on exactly the dragged occurrence.
    const wall = zonedDate(original.scheduledStartTime, tz);
    const [y, m, d] = targetKey.split("-").map(Number);
    wall.setFullYear(y, m - 1, d);
    const newStart = zonedWallClockToUtc(wall, tz);

    const prevTasks = tasks;
    setTasks((cur) =>
      (cur ?? []).map((t) =>
        t.id === original.id
          ? { ...t, scheduledStartTime: newStart.toISOString() }
          : t,
      ),
    );

    try {
      const res = await rescheduleTask(original.id, newStart.toISOString());
      setTasks((cur) =>
        (cur ?? []).map((t) => (t.id === original.id ? res.task : t)),
      );
    } catch (error) {
      setTasks(prevTasks ?? []); // rollback the optimistic move
      toast(errorMessage(error, "Couldn't reschedule task"), "destructive");
    }
  }

  const ghostTask = dragging?.task ?? null;
  const ghostState = ghostTask ? deriveState(ghostTask) : null;

  return (
    <View ref={pageRef} onLayout={handlePageLayout} className="flex-1">
      {tasks === null ? (
        <MonthGridSkeleton />
      ) : (
        <MonthGrid
          ref={gridRef}
          monthDate={monthDate}
          days={days}
          tz={tz}
          today={today}
          tasksByDate={tasksByDate}
          highlightedKey={highlightedKey}
          draggingTaskId={dragging?.task.id ?? null}
          onPressDay={onOpenDay}
          onPressOverflow={onOpenOverflow}
          onPillDragStart={handlePillDragStart}
          onPillDragUpdate={handlePillDragUpdate}
          onPillDragEnd={handlePillDragEnd}
          onGridLayout={handleGridLayout}
        />
      )}

      {/* Drop-target highlight lives on `MonthCell` itself (`isDropTarget`);
          this floating pill is just the dragged copy following the finger. */}
      {ghostTask && ghostPos && ghostState && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: ghostPos.x - pageOffsetRef.current.x - 55,
            top: ghostPos.y - pageOffsetRef.current.y - 34,
            width: 110,
          }}
        >
          <View
            className={cn(
              "rounded-[6px] border-l-2 px-1.5 py-1 shadow-lg",
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
              {ghostTask.title}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
