import { listSessions, updateSession } from "@/api/tasks";
import { AlertTriangle, RefreshCcw, RotateCw } from "@/components/Icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import { useUserStore } from "@/hooks/use-user-store";
import { type PeekBlock, peekBlocksFromSegments } from "@/lib/peek";
import {
  fetchDaySessions,
  getCachedDaySessions,
  isDayCacheFresh,
  setCachedDaySessions,
} from "@/lib/session-cache";
import { isPastDeadlineDrop } from "@/lib/overdue";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import {
  getTimelineScrollFraction,
  setTimelineScrollFraction,
  subscribeTimelineScroll,
} from "@/lib/timeline-scroll";
import {
  DAILY_HORIZON,
  TIME_GRANULARITY,
  eventsForDay,
  getOverlapLayout,
  tasksToBlocks,
  zonedNow,
  zonedWallClockToUtc,
} from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { addDays, format, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  clamp,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { NowIndicator } from "./now-indicator";
import { SessionBlock } from "./task-block";
import { TimeGutter } from "./time-gutter";

const GUTTER_WIDTH = 64;
const EMPTY_GHOST_MINUTES = 45;
const HOUR_HEIGHT_DEFAULT = 64;
const HOUR_HEIGHT_MIN = 48;
const HOUR_HEIGHT_MAX = 96;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * How many hours past midnight the grid keeps scrolling into, when the next day
 * has anything in that window — a task from *this* day that the scheduler
 * placed across midnight (it can now start as late as 23:45 and run its full
 * length past 00:00, see `docs/scheduler/heuristic.md`), or an early task on
 * the next day. The tail region is dimmed ("tomorrow") and read-only.
 */
const OVERNIGHT_TAIL_HOURS = 6;

/** Minutes-from-local-midnight of an ISO instant, in `tz`. */
function minutesOfDayLocal(iso: string, tz: string): number {
  const d = toZonedTime(new Date(iso), tz);
  return d.getHours() * 60 + d.getMinutes();
}

const LOADING_PLACEHOLDERS = [
  { startMin: 8 * 60 + 15, duration: 60 },
  { startMin: 10 * 60, duration: 110 },
  { startMin: 12 * 60 + 30, duration: 90 },
  { startMin: 15 * 60, duration: 45 },
];

function scrollToNowOffset(totalHeight: number, tz: string): number {
  // Wall clock in the user's tz — matches `NowIndicator` (which uses
  // `toZonedTime(now, tz)`); a bare `new Date()` here read the device zone and
  // scrolled to the wrong hour when the two differed.
  const now = zonedNow(tz);
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, (mins / DAILY_HORIZON) * totalHeight - 120);
}

/**
 * Do two session lists render identically? Paging back to a day whose cache has
 * gone stale triggers a revalidation fetch that almost always returns the same
 * data — without this guard the resulting `setSessions(freshArray)` re-renders
 * the whole timeline (new `segments`, every `SessionBlock` re-mounts its memo)
 * for no visible change, which reads as a flicker. Compare only the fields the
 * timeline actually draws from.
 */
function sameSessions(a: Session[], b: Session[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.scheduledStartTime !== y.scheduledStartTime ||
      x.durationMinutes !== y.durationMinutes ||
      x.deadline !== y.deadline ||
      x.type !== y.type ||
      x.updatedAt !== y.updatedAt
    ) {
      return false;
    }
  }
  return true;
}

export type TimelineState = "loading" | "error" | "ready";

interface DayTimelineProps {
  date?: Date;
  onSessionPress?: (taskId: string) => void;
  onLongPress?: (timeISO: string) => void;
  refreshKey?: number;
  onStateChange?: (state: TimelineState) => void;
  /** Hide the per-day header — the Week screen renders its own sticky
   * `WeekHeader` strip above the pager. Default `true` preserves the Day
   * screen. */
  showHeader?: boolean;
  /** Show the "Long press to add" ghost on empty non-today days too — the
   * Week pager surfaces it on any empty day. Default `false`. */
  showEmptyGhostAlways?: boolean;
  /** Bottom padding for the scroll content (px). When omitted, falls back to
   * `tabBarOverlay` if the header is shown, else `0`. The Day pager passes the
   * overlay height explicitly so its headerless pages still scroll clear of
   * the floating tab-bar pill while the grid stays full-bleed behind it. */
  contentBottomInset?: number;
  /** Reports the one-line status shown under the day title (task/overlap
   * count, "Now …", load state) so a parent drawing its own header keeps the
   * same live status. */
  onSubtitleChange?: (subtitle: string) => void;
  /** Fired when a session drag starts/stops (used to lock the pager). */
  onDragChange?: (dragging: boolean) => void;
  /** Fired when a still-finger long-press on a block asks to move it — the
   * screen opens the "Move to…" sheet. This timeline resolves the id to the
   * full `Session` from its own list before calling up. */
  onRequestReschedule?: (session: Session) => void;
  /** Reports this day's sessions as mini-day blocks so a parent week pager
   * can render its next-day peek strip from real data. */
  onPeekChange?: (blocks: PeekBlock[], dayKey: string) => void;
  /** Right padding (px) reserved on the grid for a parent's next-day peek
   * sliver, so blocks/lines stop short of it instead of running under it.
   * Default 0. */
  rightInset?: number;
  /** True when this is the page the pager is focused on. Only the active page
   * is the source of truth for the shared scroll position (`syncScroll`) and
   * only it should drive a parent's header/slice callbacks. Default `true` for
   * standalone use. */
  isActive?: boolean;
  /** Opt in to the cross-day shared vertical scroll position — swiping between
   * days keeps the same time-of-day in view (`lib/timeline-scroll.ts`). The
   * Week pager sets this; standalone timelines keep their own per-day
   * "scroll to now". Default `false`. */
  syncScroll?: boolean;
  /** Session id (or occurrence id) to play the one-shot "just landed" entrance
   * on — set when the calendar teleports to a freshly created / rescheduled
   * session. Cleared by the parent shortly after. */
  flashSessionId?: string | null;
}

export function DayTimeline({
  date: propDate,
  onSessionPress,
  onLongPress,
  refreshKey,
  onStateChange,
  showHeader = true,
  showEmptyGhostAlways = false,
  contentBottomInset,
  onSubtitleChange,
  onDragChange,
  onRequestReschedule,
  onPeekChange,
  rightInset = 0,
  isActive = true,
  syncScroll = false,
  flashSessionId = null,
}: DayTimelineProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const { confirm } = useToast();
  const scrollRef = useRef<ScrollView>(null);
  const { width: screenWidth } = useWindowDimensions();
  const now = useNow();
  const tabBarOverlay = useTabBarOverlayHeight();

  // When it's today, the displayed day follows the live clock so the header
  // date auto-advances across midnight instead of freezing on yesterday.
  const date = useMemo(() => {
    if (!propDate) return toZonedTime(now, tz);
    const live = toZonedTime(now, tz);
    const sameDay =
      live.getFullYear() === propDate.getFullYear() &&
      live.getMonth() === propDate.getMonth() &&
      live.getDate() === propDate.getDate();
    return sameDay ? live : propDate;
  }, [propDate, now, tz]);
  const [hourHeight, setHourHeight] = useState(HOUR_HEIGHT_DEFAULT);
  const totalHeight = hourHeight * 24;
  const contentWidth = screenWidth - GUTTER_WIDTH - rightInset;

  const dayKey = format(date, "yyyy-MM-dd");
  const nextDate = useMemo(() => addDays(startOfDay(date), 1), [date]);
  const nextDayKey = format(nextDate, "yyyy-MM-dd");

  // Seed from the session cache so a day already visited this session paints
  // instantly (stale-while-revalidate) — no skeleton flash when paging back
  // to it in Week/Day view. A fresh fetch below always runs and reconciles.
  const [tasks, setSessions] = useState<Session[]>(
    () => getCachedDaySessions(dayKey) ?? [],
  );
  const [loading, setLoading] = useState(
    () => getCachedDaySessions(dayKey) == null,
  );
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dragSnap, setDragSnap] = useState<{ startMin: number } | null>(null);
  // Session id to pulse right now — a within-day drag drop flashes the moved
  // block in place; a teleport passes `flashSessionId` down instead.
  const [rescheduleFlashId, setRescheduleFlashId] = useState<string | null>(
    null,
  );
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRescheduleFlash = useCallback((id: string) => {
    setRescheduleFlashId(id);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setRescheduleFlashId(null), 900);
  }, []);
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );
  const effectiveFlashId = rescheduleFlashId ?? flashSessionId;

  const baseHourHeight = useSharedValue(HOUR_HEIGHT_DEFAULT);
  const ghostY = useSharedValue(0);
  const ghostVisible = useSharedValue(0);
  // Px the grid has auto-scrolled since the current block drag began (0 when
  // idle). Shared with every `SessionBlock` so a dragged block stays under the
  // finger while the grid scrolls and its drop slot accounts for the travel.
  const autoScrollDeltaSV = useSharedValue(0);
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  const contentHeightRef = useRef(0);
  const autoScrollDirRef = useRef<-1 | 0 | 1>(0);
  const autoScrollRafRef = useRef<number | null>(null);
  const prevRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    let cancelled = false;
    // A screen-focus bump (`refreshKey`) is a hard "something may have changed
    // elsewhere" signal and always revalidates. A plain mount / page-in is
    // not.
    const focusChanged = refreshKey !== prevRefreshKeyRef.current;
    prevRefreshKeyRef.current = refreshKey;

    // Show the full-screen skeleton only when there's genuinely nothing
    // cached for this day. A warm day (screen focus, implicit day-reschedule
    // after a create/edit, paging back to a visited day) updates `tasks` in
    // place — the timeline stays mounted so derived rendering doesn't flicker
    // off. Pull-to-refresh has its own `RefreshControl` signal.
    const cached = getCachedDaySessions(dayKey);
    if (cached == null) setLoading(true);

    // Paging back to a day fetched seconds ago: reuse the cache, no network,
    // no skeleton — this is what removed the "swipe away, swipe back, watch it
    // reload" flicker. Focus refetches still fall through.
    if (cached != null && !focusChanged && isDayCacheFresh(dayKey)) {
      setSessions(cached);
      setError(false);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setError(false);
    // `fetchDaySessions` de-dupes concurrent requests for the same day, so a
    // fast double-swipe or a focus refetch landing on a still-pending mount
    // fetch share one promise.
    fetchDaySessions(dayKey, () =>
      listSessions("day", date).then((res) => res.sessions),
    )
      .then((sessions) => {
        // A revalidation that came back identical must not re-render — that's
        // the swipe-back flicker.
        if (!cancelled)
          setSessions((prev) =>
            sameSessions(prev, sessions) ? prev : sessions,
          );
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dayKey, refreshKey]);

  useEffect(() => {
    onStateChange?.(loading ? "loading" : error ? "error" : "ready");
  }, [loading, error, onStateChange]);

  // Hold the skeleton back a beat: a fetch that resolves quickly (the common
  // case on a warm connection) never flashes it, which is what made paging
  // feel abrupt. A cold day still gets the skeleton once the wait is real.
  const [skeletonVisible, setSkeletonVisible] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSkeletonVisible(false);
      return;
    }
    const t = setTimeout(() => setSkeletonVisible(true), 160);
    return () => clearTimeout(t);
  }, [loading]);

  const refetch = useCallback(async () => {
    try {
      const res = await listSessions("day", date);
      setCachedDaySessions(format(date, "yyyy-MM-dd"), res.sessions);
      setSessions((prev) =>
        sameSessions(prev, res.sessions) ? prev : res.sessions,
      );
      setError(false);
    } catch {
      setError(true);
    }
  }, [date]);

  // The early hours of the *next* day, drawn dimmed below the midnight line so
  // the timeline reads continuously across it: the post-midnight tail of a task
  // this day's scheduler placed across midnight, plus any genuine early task on
  // the next day. Seeded from the session cache and prefetched (deduped) so the
  // tail is populated before the user pages onto that day.
  const [nextDayTasks, setNextDayTasks] = useState<Session[]>(
    () => getCachedDaySessions(nextDayKey) ?? [],
  );
  useEffect(() => {
    let cancelled = false;
    const cached = getCachedDaySessions(nextDayKey);
    if (cached) setNextDayTasks(cached);
    fetchDaySessions(nextDayKey, () =>
      listSessions("day", nextDate).then((r) => r.sessions),
    )
      .then((s) => {
        if (!cancelled)
          setNextDayTasks((prev) => (sameSessions(prev, s) ? prev : s));
      })
      .catch(() => {
        /* the tail just stays empty; the main day is unaffected */
      });
    return () => {
      cancelled = true;
    };
  }, [nextDayKey, refreshKey, nextDate]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const segments = useMemo(() => {
    const blocks = tasksToBlocks(tasks);
    return eventsForDay(blocks, date, tz);
  }, [tasks, date, tz]);

  const layout = useMemo(() => getOverlapLayout(segments), [segments]);

  // Genuine early tasks on the *next* day — the `::tail` piece of this day's
  // own crossing blocks is excluded because those blocks now draw their full
  // height straight through the midnight line (`drawThroughMidnight`).
  const tailSegments = useMemo(() => {
    const cutoff = OVERNIGHT_TAIL_HOURS * 60;
    return eventsForDay(tasksToBlocks(nextDayTasks), nextDate, tz).filter(
      (s) => !s.continued && minutesOfDayLocal(s.start, tz) < cutoff,
    );
  }, [nextDayTasks, nextDate, tz]);
  const tailLayout = useMemo(
    () => getOverlapLayout(tailSegments),
    [tailSegments],
  );

  // A task on *this* day that the scheduler placed across midnight — known
  // immediately from this day's own data, so the extended region is reserved
  // on first paint (no late "tail pops in" flash).
  const thisDayCrosses = useMemo(
    () => segments.some((s) => s.continues),
    [segments],
  );
  const showTail = thisDayCrosses || tailSegments.length > 0;

  // Only extend the grid as far as there is actually content past midnight
  // (rounded up to the hour), capped at OVERNIGHT_TAIL_HOURS.
  const tailHours = useMemo(() => {
    if (!showTail) return 0;
    let maxMin = 60;
    for (const s of segments) {
      if (s.continues) {
        maxMin = Math.max(maxMin, minutesOfDayLocal(s.taskEnd, tz));
      }
    }
    for (const s of tailSegments) {
      maxMin = Math.max(maxMin, minutesOfDayLocal(s.end, tz));
    }
    return Math.min(OVERNIGHT_TAIL_HOURS, Math.max(1, Math.ceil(maxMin / 60)));
  }, [showTail, segments, tailSegments, tz]);
  const tailHeight = hourHeight * tailHours;

  const bottomInset = contentBottomInset ?? (showHeader ? tabBarOverlay : 0);
  contentHeightRef.current =
    totalHeight + (showTail ? tailHeight : 0) + bottomInset;

  // Report this day's blocks so a parent Week pager can draw its next-day
  // peek strip from real data.
  const peekBlocks = useMemo(
    () => peekBlocksFromSegments(segments, date, tz),
    [segments, date, tz],
  );

  useEffect(() => {
    onPeekChange?.(peekBlocks, dayKey);
  }, [peekBlocks, dayKey, onPeekChange]);

  const deadlineBySession = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      if (t.deadline) map.set(t.id, t.deadline);
    }
    return map;
  }, [tasks]);

  const overlapCount = useMemo(() => {
    // DND blocks are protected time, not commitments — they don't count toward
    // the "N overlapping" hint.
    const live = segments.filter((s) => s.type !== "DND");
    let pairs = 0;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const aStart = new Date(live[i].start).getTime();
        const aEnd = new Date(live[i].end).getTime();
        const bStart = new Date(live[j].start).getTime();
        const bEnd = new Date(live[j].end).getTime();
        if (aStart < bEnd && bStart < aEnd) pairs++;
      }
    }
    return pairs;
  }, [segments]);

  const scrollToNow = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        y: scrollToNowOffset(totalHeight, tz),
        animated: false,
      });
    }
  }, [totalHeight, tz]);

  // Read inside subscription / scroll callbacks that must not re-fire on every
  // active/zoom change.
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const totalHeightRef = useRef(totalHeight);
  totalHeightRef.current = totalHeight;

  // Position the vertical scroll ONCE per day: ~8am while the first load is
  // pending, then "now" when it resolves. `onLayout` fires repeatedly while an
  // enclosing horizontal pager re-centers (Week/Day view), and re-running this
  // every time is what yanked the timeline to "now" — near the bottom in the
  // evening — mid-swipe. The ref makes it idempotent; the effect drives the
  // pending→resolved transition without depending on `onLayout` timing.
  //
  // With `syncScroll` (Week pager) a shared position takes over the moment it
  // exists: every page — loading or not — restores to it instead of running
  // its own "scroll to now", so swiping between days holds the same hours in
  // view. The one-time "now" positioning still runs on the very first timeline
  // of the session (shared fraction still `null`) and seeds the shared value.
  const positionedRef = useRef<"none" | "pending" | "resolved">("none");
  const positionScroll = useCallback(() => {
    if (error) return;
    if (syncScroll) {
      const shared = getTimelineScrollFraction();
      if (shared != null) {
        if (positionedRef.current === "resolved") return;
        positionedRef.current = "resolved";
        scrollRef.current?.scrollTo({
          y: shared * totalHeight,
          animated: false,
        });
        return;
      }
    }
    if (loading) {
      if (positionedRef.current !== "none") return;
      positionedRef.current = "pending";
      const loadingOffset = ((8 * 60) / DAILY_HORIZON) * totalHeight - 120;
      scrollRef.current?.scrollTo({
        y: Math.max(0, loadingOffset),
        animated: false,
      });
      return;
    }
    if (positionedRef.current === "resolved") return;
    positionedRef.current = "resolved";
    scrollToNow();
    if (syncScroll) {
      // Seed without notifying — no other page needs to move for the cold
      // open, and a notify here would fight the neighbours' own positioning.
      setTimelineScrollFraction(
        scrollToNowOffset(totalHeight, tz) / totalHeight,
        false,
      );
    }
  }, [loading, error, totalHeight, scrollToNow, syncScroll, tz]);

  useEffect(() => {
    positionScroll();
  }, [positionScroll]);

  // Off-screen pages follow the focused page's scroll so paging in lands on
  // the same hours. The focused page is the writer and ignores its own echo.
  useEffect(() => {
    if (!syncScroll) return;
    return subscribeTimelineScroll(() => {
      if (isActiveRef.current) return;
      const f = getTimelineScrollFraction();
      if (f == null) return;
      scrollRef.current?.scrollTo({
        y: f * totalHeightRef.current,
        animated: false,
      });
    });
  }, [syncScroll]);

  const handleTimelineLayout = useCallback(
    (e: LayoutChangeEvent) => {
      viewportHRef.current = e.nativeEvent.layout.height;
      positionScroll();
    },
    [positionScroll],
  );

  const lastScrollWriteRef = useRef(0);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollYRef.current = e.nativeEvent.contentOffset.y;
      if (!syncScroll || !isActiveRef.current) return;
      // Publish the focused page's position (as a fraction of the day's content
      // height, so a per-day zoom still maps to the same time) for the
      // off-screen pages to follow. Lightly throttled — the neighbours only
      // need to be roughly right until they're paged in.
      const t = Date.now();
      if (t - lastScrollWriteRef.current <= 80) return;
      lastScrollWriteRef.current = t;
      setTimelineScrollFraction(
        e.nativeEvent.contentOffset.y / totalHeightRef.current,
        true,
      );
    },
    [syncScroll],
  );

  // ── Auto-scroll while a block is dragged near a screen edge ───────────────
  const AUTOSCROLL_STEP = 9; // px per frame (~540 px/s at 60fps)
  const runAutoScroll = useCallback(() => {
    const dir = autoScrollDirRef.current;
    if (dir === 0 || !scrollRef.current) {
      autoScrollRafRef.current = null;
      return;
    }
    const maxScroll = Math.max(
      0,
      contentHeightRef.current - viewportHRef.current,
    );
    const next = Math.min(
      maxScroll,
      Math.max(0, scrollYRef.current + dir * AUTOSCROLL_STEP),
    );
    if (next !== scrollYRef.current) {
      autoScrollDeltaSV.value += next - scrollYRef.current;
      scrollYRef.current = next;
      scrollRef.current.scrollTo({ y: next, animated: false });
    }
    autoScrollRafRef.current = requestAnimationFrame(runAutoScroll);
  }, [autoScrollDeltaSV]);

  const handleDragVerticalEdge = useCallback(
    (dir: -1 | 0 | 1) => {
      autoScrollDirRef.current = dir;
      if (dir !== 0 && autoScrollRafRef.current == null) {
        autoScrollRafRef.current = requestAnimationFrame(runAutoScroll);
      }
    },
    [runAutoScroll],
  );

  useEffect(
    () => () => {
      if (autoScrollRafRef.current != null) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
    },
    [],
  );

  const isToday = useMemo(() => {
    const live = toZonedTime(now, tz);
    return (
      live.getFullYear() === date.getFullYear() &&
      live.getMonth() === date.getMonth() &&
      live.getDate() === date.getDate()
    );
  }, [date, now, tz]);

  const handleReschedule = useCallback(
    async (taskId: string, startISO: string) => {
      const commit = async () => {
        try {
          const updated = await updateSession(taskId, {
            scheduledStartTime: startISO,
          });
          // Patch the dragged task from the authoritative response so its new
          // time shows immediately; the refetch below re-derives every card's
          // overlap-based conflict state (client-side only, see `withOverlap`),
          // since neighbors' state can shift too.
          setSessions((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)),
          );
          triggerRescheduleFlash(taskId);
        } catch {
          // Swallow the error — the finally below reconciles from the server.
        } finally {
          await refetch();
        }
      };

      // Dragging a block past its own deadline is almost always a slip — ask
      // before committing. Cancelling just refetches, which snaps the block
      // back to its real (server) position.
      const deadline = deadlineBySession.get(taskId) ?? null;
      if (isPastDeadlineDrop(startISO, deadline)) {
        confirm("Schedule after the deadline?", {
          description: "This session will start past its due time.",
          confirmLabel: "Schedule anyway",
          cancelLabel: "Cancel",
          onConfirm: () => {
            void commit();
          },
          onCancel: () => {
            void refetch();
          },
        });
        return;
      }

      await commit();
    },
    [confirm, deadlineBySession, refetch, triggerRescheduleFlash],
  );

  const handleDragStateChange = useCallback(
    (snap: { startMin: number } | null) => {
      setDragSnap(snap);
      onDragChange?.(snap !== null);
      if (snap === null) {
        // Drag ended — stop any auto-scroll and clear its accumulated offset.
        autoScrollDirRef.current = 0;
        if (autoScrollRafRef.current != null) {
          cancelAnimationFrame(autoScrollRafRef.current);
          autoScrollRafRef.current = null;
        }
        autoScrollDeltaSV.value = 0;
      }
    },
    [onDragChange, autoScrollDeltaSV],
  );

  // Resolve the block id from a long-press up to the full `Session` for the
  // screen's "Move to…" sheet.
  const handleRequestReschedule = useCallback(
    (taskId: string) => {
      const session = tasks.find((t) => t.id === taskId);
      if (session) onRequestReschedule?.(session);
    },
    [tasks, onRequestReschedule],
  );

  const formatSnapLabel = useCallback(
    (snap: { startMin: number } | null) => {
      if (!snap) return "";
      // `date` is already the tz wall clock in its local fields — a plain copy,
      // never a second `zonedDate` (which would double-apply the tz offset).
      const wall = new Date(date);
      wall.setHours(Math.floor(snap.startMin / 60), snap.startMin % 60, 0, 0);
      return wall.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
    },
    [date, tz],
  );

  const dragChipLabel = useMemo(
    () => formatSnapLabel(dragSnap),
    [formatSnapLabel, dragSnap],
  );

  const handleLongPress = useCallback(
    (y: number) => {
      const pxPerMin = totalHeight / DAILY_HORIZON;
      const minutes =
        Math.round(y / pxPerMin / TIME_GRANULARITY) * TIME_GRANULARITY;
      const clampedMin = Math.max(
        0,
        Math.min(DAILY_HORIZON - TIME_GRANULARITY, minutes),
      );

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // `date` already carries the tz wall clock in its local fields — copy it
      // plainly, set the pressed time, then convert once to a true instant.
      // A second `zonedDate(date, tz)` here re-applied the offset and rolled an
      // evening press to the next calendar day for +ve tz offsets.
      const wall = new Date(date);
      wall.setHours(Math.floor(clampedMin / 60), clampedMin % 60, 0, 0);
      const wallISO = zonedWallClockToUtc(wall, tz).toISOString();

      // Open create-task at the pressed time
      onLongPress?.(wallISO);
    },
    [date, tz, totalHeight],
  );

  const zoomGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const newHeight = clamp(
        baseHourHeight.value * e.scale,
        HOUR_HEIGHT_MIN,
        HOUR_HEIGHT_MAX,
      );
      baseHourHeight.value = newHeight;
    })
    .onEnd(() => {
      runOnJS(setHourHeight)(baseHourHeight.value);
    });

  const longPressGesture = Gesture.LongPress()
    .minDuration(500)
    .onBegin((e) => {
      const pxPerMin = totalHeight / DAILY_HORIZON;
      const minutes =
        Math.round(e.absoluteY / pxPerMin / TIME_GRANULARITY) *
        TIME_GRANULARITY;
      const clampedMin = Math.max(
        0,
        Math.min(DAILY_HORIZON - TIME_GRANULARITY, minutes),
      );
      ghostY.value = (clampedMin / DAILY_HORIZON) * totalHeight;
      ghostVisible.value = withTiming(1, { duration: 200 });
    })
    .onEnd((e) => {
      ghostVisible.value = withTiming(0, { duration: 150 });
      runOnJS(handleLongPress)(e.absoluteY);
    })
    .onFinalize(() => {
      ghostVisible.value = withTiming(0, { duration: 150 });
    });

  const contentGesture = Gesture.Simultaneous(zoomGesture, longPressGesture);

  const animatedContentStyle = useAnimatedStyle(() => ({
    height:
      baseHourHeight.value * 24 +
      (showTail ? baseHourHeight.value * tailHours : 0),
  }));

  const ghostStyle = useAnimatedStyle(() => ({
    top: ghostY.value,
    opacity: ghostVisible.value,
  }));

  const nowClock = toZonedTime(now, tz);
  const nowMinutes = nowClock.getHours() * 60 + nowClock.getMinutes();
  const nowLabel = `Now ${nowClock.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
  const emptyGhostTop =
    (Math.min(nowMinutes, DAILY_HORIZON - EMPTY_GHOST_MINUTES) /
      DAILY_HORIZON) *
    totalHeight;
  const emptyGhostHeight = (EMPTY_GHOST_MINUTES / DAILY_HORIZON) * totalHeight;

  // The one-line status shown under the day title — rendered in the built-in
  // header, and also reported up (`onSubtitleChange`) so a parent that draws
  // its own header (the Day pager) keeps the same live status.
  const subtitle = loading
    ? "Loading your day…"
    : error
      ? "Couldn't sync"
      : dragSnap
        ? "Moving · release to reschedule"
        : overlapCount > 0
          ? `${overlapCount} overlap${overlapCount > 1 ? "s" : ""} · ${
              tasks.length
            } tasks`
          : tasks.length === 0
            ? `${nowLabel} · nothing scheduled`
            : `${nowLabel} · ${tasks.length} task${
                tasks.length === 1 ? "" : "s"
              } today`;

  useEffect(() => {
    onSubtitleChange?.(subtitle);
  }, [subtitle, onSubtitleChange]);

  // Initial scroll offset applied via `contentOffset` so a freshly-mounted
  // page (a swipe brings a new day into the 3-page window) paints already at
  // the right position — no one-frame flash of "top of day" before
  // `positionScroll` jumps it. Computed once; `positionScroll` still drives
  // the cold-open loading→"now" transition.
  const initialContentOffset = useMemo(() => {
    const shared = syncScroll ? getTimelineScrollFraction() : null;
    const y =
      shared != null
        ? shared * totalHeight
        : Math.max(0, ((8 * 60) / DAILY_HORIZON) * totalHeight - 120);
    // Computed once, on mount — a stable identity so React Native never
    // re-applies it and fights a later scroll.
    return { x: 0, y };
  }, []);

  return (
    <View className="flex-1 bg-background">
      {showHeader && (
        <View className="flex-row items-center justify-between px-4 pt-4 pb-4 border-b border-black/15 dark:border-white/15">
          <View className="min-w-0 flex-1">
            <Text className="text-xl font-bold tracking-tight">
              {format(date, "EEE, MMM d")}
            </Text>
            <Text className="mt-px text-xs font-medium text-muted-foreground">
              {subtitle}
            </Text>
          </View>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentOffset={initialContentOffset}
        onLayout={handleTimelineLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerClassName={
          error ? "flex-1 items-center justify-center px-8" : undefined
        }
        contentContainerStyle={
          error
            ? undefined
            : {
                // The Day pager passes `contentBottomInset` so its headerless
                // pages still clear the floating tab-bar pill; the Week pager
                // omits it and applies its own inset around the whole pager.
                paddingBottom:
                  contentBottomInset ?? (showHeader ? tabBarOverlay : 0),
              }
        }
      >
        {error ? (
          <>
            <View className="mb-3.5 size-[76px] items-center justify-center rounded-[22px] border border-destructive/35 bg-destructive/15">
              <AlertTriangle size={34} className="text-destructive" />
            </View>
            <Text className="text-center text-lg font-bold">
              Couldn't load your day
            </Text>
            <Text className="mt-1.5 max-w-[280px] text-center text-[13.5px] leading-normal text-muted-foreground">
              We couldn't reach the scheduler. Check your connection and try
              again.
            </Text>
            <Button
              variant="outline"
              className="mt-5 rounded-xl px-8 gap-2"
              onPress={() => void refetch()}
            >
              <RotateCw size={16} className="text-foreground" />
              <Text className="text-base font-semibold"> Try again</Text>
            </Button>
          </>
        ) : loading && skeletonVisible ? (
          <Animated.View style={animatedContentStyle} className="relative">
            <TimeGutter hourHeight={hourHeight} />

            <View
              className="absolute top-0 bottom-0 bg-card"
              style={{ left: GUTTER_WIDTH, right: rightInset }}
            >
              {HOURS.map((hour) => (
                <View
                  key={hour}
                  className="absolute left-0 right-0 bg-border/50"
                  style={{
                    top: hour * hourHeight,
                    height: 1,
                  }}
                />
              ))}

              {LOADING_PLACEHOLDERS.map((p) => (
                <View
                  key={p.startMin}
                  className="absolute left-1.5 right-1.5"
                  style={{
                    top: (p.startMin / DAILY_HORIZON) * totalHeight,
                    height: (p.duration / DAILY_HORIZON) * totalHeight,
                  }}
                >
                  <Skeleton className="h-full w-full rounded-xl" />
                </View>
              ))}
            </View>
          </Animated.View>
        ) : (
          <GestureDetector gesture={contentGesture}>
            <Animated.View style={animatedContentStyle} className="relative">
              <TimeGutter hourHeight={hourHeight} />

              {showTail && (
                <View
                  className="absolute left-0"
                  style={{
                    top: totalHeight,
                    width: GUTTER_WIDTH,
                    height: tailHeight,
                  }}
                >
                  <TimeGutter
                    hourHeight={hourHeight}
                    fromHour={0}
                    toHour={tailHours}
                    showZeroLabel
                  />
                </View>
              )}

              <View
                className="absolute top-0 bottom-0 bg-card"
                style={{ left: GUTTER_WIDTH, right: rightInset }}
              >
                {/* Hour separator lines */}
                {HOURS.map((hour) => (
                  <View
                    key={hour}
                    className="absolute left-0 right-0 bg-border/50"
                    style={{
                      top: hour * hourHeight,
                      height: 1,
                    }}
                  />
                ))}

                {showTail && (
                  <>
                    {/* Dimmed "tomorrow" wash + its own hour lines. */}
                    <View
                      pointerEvents="none"
                      className="absolute left-0 right-0 bg-muted/40"
                      style={{ top: totalHeight, height: tailHeight }}
                    />
                    {Array.from({ length: tailHours }, (_, i) => (
                      <View
                        key={`tail-line-${i}`}
                        className="absolute left-0 right-0 bg-border/50"
                        style={{ top: totalHeight + i * hourHeight, height: 1 }}
                      />
                    ))}
                  </>
                )}

                {isToday && (
                  <NowIndicator now={now} tz={tz} totalHeight={totalHeight} />
                )}

                {segments.length === 0 && (isToday || showEmptyGhostAlways) && (
                  <View
                    pointerEvents="none"
                    className="absolute left-1.5 right-1.5 z-20 items-center justify-center rounded-xl border-[1.5px] border-dashed border-brand-orange/55 bg-brand-orange/[0.07]"
                    style={{ top: emptyGhostTop, height: emptyGhostHeight }}
                  >
                    <Text className="text-xs font-semibold text-brand-orange">
                      Long press to add
                    </Text>
                  </View>
                )}

                {segments.map((segment) => {
                  const blockLayout = layout.get(segment.segmentId) ?? {
                    column: 0,
                    columns: 1,
                    conflict: false,
                  };
                  const blockWidthPx = contentWidth / blockLayout.columns;
                  const leftOffsetPx = blockLayout.column * blockWidthPx;

                  return (
                    <SessionBlock
                      key={segment.segmentId}
                      segment={segment}
                      layout={blockLayout}
                      tz={tz}
                      totalHeight={totalHeight}
                      leftOffset={leftOffsetPx}
                      blockWidth={blockWidthPx}
                      deadline={deadlineBySession.get(segment.taskId) ?? null}
                      onReschedule={handleReschedule}
                      onDragStateChange={handleDragStateChange}
                      onPress={onSessionPress}
                      onRequestReschedule={handleRequestReschedule}
                      drawThroughMidnight
                      autoScrollDeltaSV={
                        segment.type === "TASK" && !segment.continued
                          ? autoScrollDeltaSV
                          : undefined
                      }
                      onDragVerticalEdge={handleDragVerticalEdge}
                      bottomInset={tabBarOverlay}
                      flash={segment.taskId === effectiveFlashId}
                    />
                  );
                })}

                {/* The next day's early hours, dimmed and read-only, so a task
                  the scheduler placed across midnight reads as one continuous
                  run and tomorrow's first commitments are visible in context.
                  Each block positions itself from local-midnight, so the
                  wrapper just pushes the whole set below the 24:00 line. */}
                {showTail && (
                  <View
                    pointerEvents="none"
                    className="absolute left-0 right-0 opacity-60"
                    style={{ top: totalHeight, bottom: 0 }}
                  >
                    {tailSegments.map((segment) => {
                      const bl = tailLayout.get(segment.segmentId) ?? {
                        column: 0,
                        columns: 1,
                        conflict: false,
                      };
                      const w = contentWidth / bl.columns;
                      return (
                        <SessionBlock
                          key={`tail-${segment.segmentId}`}
                          segment={segment}
                          layout={bl}
                          tz={tz}
                          totalHeight={totalHeight}
                          leftOffset={bl.column * w}
                          blockWidth={w}
                          deadline={null}
                        />
                      );
                    })}
                  </View>
                )}

                {/* Dashed midnight boundary — drawn after the blocks so the
                  line sits over the crossing block's edge, mirroring
                  mockups/day-view.html's 12:00 AM. */}
                {showTail && (
                  <View
                    pointerEvents="none"
                    className="absolute left-0 right-0 z-20 h-0 border-t border-dashed border-muted-foreground/55"
                    style={{ top: totalHeight }}
                  >
                    <View className="absolute right-2 -translate-y-1/2 rounded-md bg-background px-1.5 py-px">
                      <Text className="text-[10px] font-bold text-muted-foreground">
                        12:00 AM
                      </Text>
                    </View>
                  </View>
                )}

                {dragSnap && (
                  <View
                    pointerEvents="none"
                    className="absolute left-0 right-0 z-20 border-t-2 border-dashed border-brand-orange"
                    style={{
                      top: (dragSnap.startMin / DAILY_HORIZON) * totalHeight,
                    }}
                  >
                    <View className="absolute right-2 -translate-y-1/2 rounded-md bg-brand-orange px-1.5 py-px">
                      <Text className="text-[10px] font-bold text-primary-foreground">
                        {dragChipLabel}
                      </Text>
                    </View>
                  </View>
                )}

                <Animated.View
                  pointerEvents="none"
                  style={ghostStyle}
                  className="absolute left-0 right-0 z-30 mx-1"
                >
                  <View className="h-[52px] items-center justify-center rounded-lg border border-dashed border-primary/50 bg-primary/5">
                    <Text className="text-xs font-medium text-primary/60">
                      + Add task
                    </Text>
                  </View>
                </Animated.View>
              </View>
            </Animated.View>
          </GestureDetector>
        )}
      </ScrollView>
    </View>
  );
}
