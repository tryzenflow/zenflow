import { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { format } from "date-fns";
import { Text } from "@/components/ui/text";
import { ChevronLeft, ChevronRight } from "@/components/Icons";
import { useColorScheme } from "@/lib/useColorScheme";
import { NAV_THEME } from "@/lib/constants";
import {
  dateKey,
  dayIndexInWeek,
  shiftDays,
  shiftWeek,
  weekDays,
} from "@/lib/week-date-math";
import {
  decideSettleTarget,
  computePagePosition,
  PARALLAX_FACTOR,
  OUTGOING_DIM_OPACITY,
  CHROME_IN_PX,
} from "@/lib/week-pager-math";
import { DayTimeline } from "./day-timeline";
import { DAY_MINUTES, type PeekBlock } from "@/lib/peek";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  clamp,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** Cross-day drags append/prepend one day to the window so the page holding
 * the lifted block stays mounted; capped at two weeks so a drop always lands
 * within the mounted pages. A drag advances exactly one day, never more. */
const MAX_DAYS = 14;

/** Hold time (ms) a lifted block must sit in the screen-edge zone before the
 * cross-day advance fires (mockup's "lifted block at the edge → jumps"). */
const CROSS_DAY_HOLD_MS = 400;

/** Width of the decorative "next day" peek strip on each page's right edge
 * (mirrors mockups/week-view.html's `w-3.5` affordance). */
const PEEK_STRIP_W = 14;

/** Duration of the settle snap (and snap-back) after a swipe ends. */
const SETTLE_MS = 200;

const BRAND_ORANGE_LIGHT = "255, 142, 62";
const BRAND_ORANGE_DARK = "255, 122, 36";

/** Block fill per task state, matching the day grid's state treatment. */
const PEEK_BLOCK_COLORS: Record<PeekBlock["state"], string> = {
  fluid: `rgba(${BRAND_ORANGE_LIGHT}, 0.55)`,
  overdue: "rgba(244, 63, 94, 0.6)",
  conflict: "rgba(245, 158, 11, 0.6)",
  completed: "rgba(16, 185, 129, 0.45)",
};

/** Right-edge sliver showing the next day's tasks as mini blocks, positioned
 * by wall-clock time and colored by task state. */
function PeekStrip({ blocks }: { blocks: PeekBlock[] }) {
  const [height, setHeight] = useState(0);
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      className="absolute top-0 bottom-0 z-[6] overflow-hidden border-l border-border bg-card"
      style={{
        width: PEEK_STRIP_W,
        right: 0,
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: -2, height: 0 },
        elevation: 2,
      }}
    >
      {height > 0 &&
        blocks.map((block) => (
          <View
            key={block.key}
            className="absolute rounded"
            style={{
              left: 3,
              width: 8,
              top: (block.startMin / DAY_MINUTES) * height,
              height: Math.max(2, (block.durationMin / DAY_MINUTES) * height),
              backgroundColor: PEEK_BLOCK_COLORS[block.state],
            }}
          />
        ))}
    </View>
  );
}

/** Edges the WeekHeader peeks at, mapped to the adjacent-day advance. */
type DragEdge = "left" | "right";

interface PagerPageProps {
  index: number;
  width: number;
  /** Strip offset in px (rest: `-focusedIndex * width`). */
  progress: SharedValue<number>;
  /** Page the strip is being dragged/settled away FROM (the outgoing,
   * parallaxing, dimming one). */
  fromSV: SharedValue<number>;
  /** Page the strip is settling ON (the incoming, stacking one). During a
   * live drag this equals `fromSV` and the incoming is derived from the
   * drag direction instead. */
  toSV: SharedValue<number>;
  /** 1 while the finger is dragging (parallax held at `PARALLAX_FACTOR`),
   * 0 during settle animations (parallax eases back to 1× so pages land
   * exactly on their slots). */
  draggingSV: SharedValue<number>;
  /** Index of the page that holds the currently-lifted task block, or −1 if
   * no task drag is active. The carried page's slot is overridden so the
   * strip snap keeps it pinned to the finger. */
  carrierIndexSV: SharedValue<number>;
  /** The carried page's `index * width + progress` at drag start — the page
   * is held at this screen position for the entire drag gesture. */
  carrierOriginSV: SharedValue<number>;
  borderColor: string;
  children: React.ReactNode;
}

/**
 * One absolutely-positioned day page in the stack. Its true position is
 * always `slot + progress`; the outgoing page additionally gets a parallax
 * offset (and the incoming one stack chrome), per
 * mockups/week-view.html's swipe-transition frame:
 * - the outgoing page moves at `PARALLAX_FACTOR`× finger speed and dims to
 *   `OUTGOING_DIM_OPACITY` as the neighbor stacks over it;
 * - the incoming page slides 1:1 at a higher z-index with a
 *   `border-l`/`border-r` seam and a soft shadow, popping over the outgoing
 *   page like a card;
 * - everything beyond the outgoing/incoming pair fades out (still mounted —
 *   the page holding a lifted task block must never unmount mid cross-day
 *   drag).
 */
function PagerPage({
  index,
  width,
  progress,
  fromSV,
  toSV,
  draggingSV,
  carrierIndexSV,
  carrierOriginSV,
  borderColor,
  children,
}: PagerPageProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const pos = computePagePosition({
      index,
      width,
      progress: progress.value,
      outIndex: fromSV.value,
      toIndex: toSV.value,
      dragging: draggingSV.value ? 1 : 0,
      carrierIndex: carrierIndexSV.value,
      carrierOrigin: carrierOriginSV.value,
    });

    const seamStyle =
      pos.seam === "left"
        ? { borderLeftWidth: 1, borderLeftColor: borderColor }
        : pos.seam === "right"
          ? { borderRightWidth: 1, borderRightColor: borderColor }
          : {};

    return {
      transform: [{ translateX: pos.translateX }],
      opacity: pos.opacity,
      zIndex: pos.zIndex,
      ...seamStyle,
    };
  });

  // The stack shadow is cast by two static-styled overlays — one per swipe
  // direction (the incoming page's shadow must fall over the outgoing page,
  // i.e. toward the side it's sliding away from). Only `opacity` is animated;
  // `shadowOffset` and friends stay in the static style, which works on web
  // and native alike.
  const rightIncomingShadow = useAnimatedStyle(() => {
    const outIndex = fromSV.value;
    const m = progress.value + outIndex * width;
    const absM = Math.abs(m);
    const inIndex =
      toSV.value === outIndex ? outIndex + (m < 0 ? 1 : -1) : toSV.value;
    const sliding = absM > CHROME_IN_PX;
    const isIncomingFromRight = inIndex === outIndex + 1;
    return {
      opacity:
        isIncomingFromRight && sliding
          ? interpolate(
              absM,
              [CHROME_IN_PX, 60],
              [0.08, 0.28],
              Extrapolation.CLAMP,
            )
          : 0,
    };
  });

  const leftIncomingShadow = useAnimatedStyle(() => {
    const outIndex = fromSV.value;
    const m = progress.value + outIndex * width;
    const absM = Math.abs(m);
    const inIndex =
      toSV.value === outIndex ? outIndex + (m < 0 ? 1 : -1) : toSV.value;
    const sliding = absM > CHROME_IN_PX;
    const isIncomingFromLeft = inIndex === outIndex - 1;
    return {
      opacity:
        isIncomingFromLeft && sliding
          ? interpolate(
              absM,
              [CHROME_IN_PX, 60],
              [0.08, 0.28],
              Extrapolation.CLAMP,
            )
          : 0,
    };
  });

  return (
    <Animated.View
      style={[
        { position: "absolute", left: 0, top: 0, bottom: 0, width },
        animatedStyle,
      ]}
      collapsable={false}
    >
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            shadowColor: "#000",
            shadowRadius: 18,
            elevation: 8,
            shadowOffset: { width: -12, height: 0 },
          },
          rightIncomingShadow,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            shadowColor: "#000",
            shadowRadius: 18,
            elevation: 8,
            shadowOffset: { width: 12, height: 0 },
          },
          leftIncomingShadow,
        ]}
      />
    </Animated.View>
  );
}

interface WeekPagerProps {
  /** The day the screen/header currently shows; the pager keeps the focused
   * page aligned with it in both directions (swipe updates it, a chip tap
   * re-centers the pager on it). */
  focusedDate: Date;
  onFocusedDateChange: (day: Date) => void;
  /** Shared refetch token passed to every page's `DayTimeline`. */
  reloadKey: number;
  onTaskPress?: (taskId: string) => void;
  onLongPress?: (timeISO: string) => void;
  /** Fired after a cross-day reschedule so the screen can refetch the target
   * day (the source day refetches itself). */
  onCrossDayReschedule: () => void;
}

/**
 * Custom "stacking" pager for the mobile Week View — a hand-rolled
 * Reanimated + Gesture.Handler replacement for the FlatList it used to be.
 * Each day is an absolutely-positioned page in a strip translated by a single
 * `progress` shared value; a horizontal `Gesture.Pan` drags it and the settle
 * (decided by the pure `decideSettleTarget` — a flick wins over a weak
 * drag) snaps exactly one page with `withTiming`.
 *
 * The transition is the mockup's swipe frame: the outgoing day parallaxes
 * out and dims while the adjacent day stacks over it with a seam + shadow.
 * The FlatList hacks it replaces (`disableIntervalMomentum`, the
 * `dragStartIndexRef` settle cap for Android, unreliable
 * `initialScrollIndex`) are all gone — one-page snapping is deterministic on
 * both platforms.
 *
 * The data window is *live*: a normal swipe that settles on the edge day
 * slides the whole window ±1 week; a cross-day task drag appends/prepends a
 * single day (up to `MAX_DAYS`), then collapses back to the 7-day window on
 * drop — so the page owning the lifted block stays mounted for the whole
 * gesture (GitHub issue #19's "cross-day drag" frame).
 */
export function WeekPager({
  focusedDate,
  onFocusedDateChange,
  reloadKey,
  onTaskPress,
  onLongPress,
  onCrossDayReschedule,
}: WeekPagerProps) {
  const { width } = useWindowDimensions();
  const { isDarkColorScheme } = useColorScheme();
  const borderColor = isDarkColorScheme
    ? NAV_THEME.dark.border
    : NAV_THEME.light.border;

  const [days, setDays] = useState<Date[]>(() => weekDays(focusedDate));
  const [focusedIndex, setFocusedIndex] = useState(() =>
    dayIndexInWeek(focusedDate),
  );
  const [dragActive, setDragActive] = useState(false);
  const [pill, setPill] = useState<{ edge: DragEdge; day: Date } | null>(null);
  // Edge whose cross-day advance is armed (orange glow lit, hold timer
  // running) — null when no zone is active or the advance already fired.
  const [armed, setArmed] = useState<DragEdge | null>(null);
  // 1 while a settle (or snap-back) animation is running: the pan is disabled
  // so a new gesture can't touch down mid-flight and clobber the settle's
  // roles/position — which used to flip the incoming/outgoing z-order mid-
  // swipe (the "next day stops covering the current day" glitch).
  const [settling, setSettling] = useState(false);
  const releaseSettle = useCallback(() => setSettling(false), []);
  // Each mounted day's mini-day blocks (from its DayTimeline's `onPeekChange`),
  // keyed by `dateKey`, so every page's strip renders the next day's real tasks.
  const [peekByDay, setPeekByDay] = useState<Record<string, PeekBlock[]>>({});

  // Strip offset in px. Rest value: `-focusedIndex * width`. Initialized from
  // the first render's focus so the window mounts showing the right day even
  // before the first layout (the FlatList's unreliable `initialScrollIndex`
  // workaround is gone; `handleFirstLayout` re-snaps as a safety net).
  const progress = useSharedValue(-dayIndexInWeek(focusedDate) * width);
  // Roles the pages' animated styles derive from (see PagerPage).
  const fromSV = useSharedValue(dayIndexInWeek(focusedDate));
  const toSV = useSharedValue(dayIndexInWeek(focusedDate));
  const draggingSV = useSharedValue(0);
  // 1 once a pan's `onEnd` has scheduled a settle, so `onFinalize` knows not
  // to snap back when the settle is already on its way.
  const didSettleSV = useSharedValue(0);
  // Index of the page holding the lifted task block (−1 = none). When set,
  // the carried page is pinned to its touch-down position so the block
  // inside stays in the hand across strip snaps.
  const carrierIndexSV = useSharedValue(-1);
  // The carried page's `index * width + progress` at drag start — held
  // constant for the entire gesture via `carrierFix` in the page style.
  const carrierOriginSV = useSharedValue(0);

  // Stable identity so DayTimeline's peek-report effect doesn't re-fire on
  // every pager render.
  const handlePeekChange = useCallback((blocks: PeekBlock[], dayKey: string) => {
    setPeekByDay((prev) =>
      prev[dayKey] === blocks ? prev : { ...prev, [dayKey]: blocks },
    );
  }, []);

  // Cross-day offset accumulated during a drag; TaskBlock adds it to the
  // rescheduled wall clock on drop, then it resets on the next drag start.
  const dayOffsetRef = useRef(0);
  // Gates the cross-day advance to exactly once per drag gesture (the strip
  // must not chain days while a finger holds past the carry threshold).
  const advancedRef = useRef(false);
  // Pending arm-timer for the cross-day hold, cleared on exit/drop/unmount.
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `armed` state kept in a ref so handleDragEdge can check
  // idempotency without re-rendering the pager (re-render recreates the
  // TaskBlock gesture handler and cancels the hold timer on web).
  const armedRef = useRef<DragEdge | null>(null);
  const hasLaidOutRef = useRef(false);

  useEffect(
    () => () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );

  const commitRoles = useCallback(
    (index: number) => {
      fromSV.value = index;
      toSV.value = index;
    },
    [fromSV, toSV],
  );

  // Commit roles at rest and unlock the pan — the default end of a settle
  // that has no state beyond the role reset (chip-tap slides).
  const finishRoles = useCallback(
    (index: number) => {
      commitRoles(index);
      setSettling(false);
    },
    [commitRoles],
  );

  // Drives the initial center position (and a chip tap to a day in a week
  // that isn't mounted) with an explicit re-snap on first layout.
  const handleFirstLayout = useCallback(() => {
    if (hasLaidOutRef.current) return;
    hasLaidOutRef.current = true;
    requestAnimationFrame(() => {
      const index = dayIndexInWeek(focusedDate);
      commitRoles(index);
      progress.value = -index * width;
    });
  }, [commitRoles, focusedDate, progress, width]);

  const snapTo = useCallback(
    (index: number, animated: boolean) => {
      if (animated) {
        progress.value = withTiming(
          -index * width,
          { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (!finished) return;
            runOnJS(releaseSettle)();
          },
        );
      } else {
        progress.value = -index * width;
      }
    },
    [progress, width, releaseSettle],
  );

  // Animates the strip from the current focus onto `target` with the
  // outgoing/incoming roles set for the whole slide, then resets the roles
  // at rest (via `onDone`, or just the role reset by default). The roles
  // must land exactly on `target` or the resting page would keep its stack
  // chrome (see PagerPage's `sliding` gate, which keys off `m`).
  const animateRolesTo = useCallback(
    (target: number, onDone?: (index: number) => void) => {
      fromSV.value = focusedIndex;
      toSV.value = target;
      progress.value = withTiming(
        -target * width,
        { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (!finished) return;
          runOnJS(onDone ?? finishRoles)(target);
        },
      );
    },
    [finishRoles, focusedIndex, fromSV, toSV, progress, width],
  );

  // External focus change (WeekHeader chip tap): scroll to the day if it's in
  // the window, otherwise rebuild the window around it. Internal changes
  // (swipe settle, drag advance/drop) already keep `days`/`focusedIndex` in
  // sync, so their re-entry here is a no-op (matching index, or the day is in
  // the freshly rebuilt window).
  useEffect(() => {
    const key = dateKey(focusedDate);
    const idx = days.findIndex((d) => dateKey(d) === key);
    if (idx >= 0) {
      if (idx === focusedIndex) return;
      setFocusedIndex(idx);
      // Only an adjacent-day tap animates the stack slide (outgoing
      // parallaxes out, tapped day stacks in). Multi-slot jumps would sweep
      // through an empty viewport — the pager paints only the outgoing/
      // incoming pair — so those snap straight to the target day.
      if (Math.abs(idx - focusedIndex) === 1) {
        // Lock the pan for the duration of the slide (same serialization as
        // a swipe settle — an interrupt must not flip the cover mid-animation).
        setSettling(true);
        animateRolesTo(idx);
      } else {
        setSettling(false);
        commitRoles(idx);
        snapTo(idx, false);
      }
      return;
    }
    const fresh = weekDays(focusedDate);
    setDays(fresh);
    setFocusedIndex(dayIndexInWeek(focusedDate));
    setSettling(false);
    commitRoles(dayIndexInWeek(focusedDate));
    snapTo(dayIndexInWeek(focusedDate), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the
    // current window; only the focused day drives this.
  }, [focusedDate]);

  // Slides the whole mounted window ±1 week (the response to a swipe that
  // settled past the window edge). The new window is swapped in with its own
  // roles committed so the freshly mounted pages render at full opacity on
  // their slots — otherwise none of them matches the old window's
  // outgoing/incoming indexes and the grid renders invisible (opacity 0).
  const slideWeek = useCallback(
    (dir: 1 | -1) => {
      if (dir === 1) {
        // Trailing edge — slide forward, focus the new week's Monday.
        const nextDays = weekDays(shiftWeek(days[days.length - 1], 1));
        setDays(nextDays);
        setFocusedIndex(0);
        onFocusedDateChange(nextDays[0]);
        progress.value = 0;
        commitRoles(0);
      } else {
        // Leading edge — slide back, focus the previous Sunday.
        const prevDays = weekDays(shiftWeek(days[0], -1));
        setDays(prevDays);
        setFocusedIndex(6);
        onFocusedDateChange(prevDays[6]);
        progress.value = -6 * width;
        commitRoles(6);
      }
      setSettling(false);
    },
    [commitRoles, days, onFocusedDateChange, progress, width],
  );

  // Commits a settled swipe. Called from the settle animation's completion
  // callback (via `runOnJS`) — never mid-animation — so the pages' animated
  // styles keep the swipe's outgoing/incoming roles for the whole slide and
  // the focus switch lands exactly at rest (no parallax-pop). Landing on an
  // edge day (0/6) just focuses that day; swiping *past* the edge is what
  // slides the week (handled by `settleOn` before the animation starts).
  const commitSettle = useCallback(
    (target: number) => {
      setSettling(false);
      commitRoles(target);
      setFocusedIndex(target);
      onFocusedDateChange(days[target]);
    },
    [commitRoles, days, onFocusedDateChange],
  );

  const settleOn = useCallback(
    (target: number) => {
      // Lock the pan for the duration of the settle so an interrupt can't
      // flip the incoming/outgoing cover mid-animation.
      setSettling(true);
      if (target < 0 || target >= days.length) {
        // Swiped past the window edge — slide the whole window one week in
        // the swipe's direction. Instant, matching the old FlatList's
        // `scrollToIndex(animated: false)`.
        slideWeek(target < 0 ? -1 : 1);
        return;
      }
      if (target === focusedIndex) {
        // Stayed on the page — spring back to rest.
        snapTo(focusedIndex, true);
        return;
      }
      // `commitSettle` handles the focus switch at animation end.
      animateRolesTo(target, commitSettle);
    },
    [animateRolesTo, commitSettle, focusedIndex, snapTo, slideWeek, days.length],
  );

  const handlePanEnd = useCallback(
    (dragPx: number, velocityX: number) => {
      const target = decideSettleTarget({
        dragPx,
        velocityX,
        startIndex: focusedIndex,
        dayCount: days.length,
        width,
      });
      settleOn(target);
    },
    [days.length, focusedIndex, settleOn, width],
  );

  // Recreated every render (captures the current `focusedIndex`/`width`).
  // `activeOffsetX` keeps it a pure horizontal pager: vertical drags fail it
  // (`failOffsetY`) and fall through to the day pages' own ScrollViews, the
  // same split the FlatList gave us. The 12px activation threshold is
  // deliberately ABOVE TaskBlock's 10px `activeOffsetX` (task-block.tsx), so
  // a gesture starting on a task block activates the block's pan first and
  // fails this one — the pager is effectively locked while a block is touched.
  // Disabled while a task drag is active (`dragActive`) or a settle is running
  // (`settling`) — both own the strip.
  const panGesture = Gesture.Pan()
    .enabled(!dragActive && !settling)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      draggingSV.value = 1;
      fromSV.value = focusedIndex;
      toSV.value = focusedIndex;
      didSettleSV.value = 0;
    })
    .onUpdate((e) => {
      // Clamp the live drag to one page so a hard flick can't pull the
      // second neighbor into view — the settle only ever moves one page.
      progress.value =
        -focusedIndex * width + clamp(e.translationX, -width, width);
    })
    .onEnd((e) => {
      draggingSV.value = 0;
      didSettleSV.value = 1;
      runOnJS(handlePanEnd)(e.translationX, e.velocityX);
    })
    .onFinalize(() => {
      // Cancelled mid-gesture (never released): snap back to rest. No settle
      // lock release here — `onEnd` already scheduled the settle (which owns
      // the lock until its animation completes); releasing it in the same
      // tick would re-enable the pan mid-animation and bring the cover-flip
      // glitch back.
      if (didSettleSV.value === 0) {
        draggingSV.value = 0;
        progress.value = withTiming(-focusedIndex * width, {
          duration: SETTLE_MS,
          easing: Easing.out(Easing.cubic),
        });
      }
    });

  // Fires after a lifted block has held in the edge zone for the hold time.
  // Exactly one advance per drag gesture — holding longer never chains days.
  const advanceCrossDay = useCallback(
    (edge: DragEdge) => {
      if (advancedRef.current) return;
      advancedRef.current = true;

      const dir = edge === "right" ? 1 : -1;
      const targetIndex = focusedIndex + dir;
      let nextIndex = targetIndex;

      if (targetIndex < 0 || targetIndex >= days.length) {
        if (days.length >= MAX_DAYS) return;
        if (dir === 1) {
          setDays([...days, shiftDays(days[days.length - 1], 1)]);
          nextIndex = days.length;
        } else {
          setDays([shiftDays(days[0], -1), ...days]);
          nextIndex = focusedIndex + 1;
        }
      }

      setFocusedIndex(nextIndex);
      dayOffsetRef.current += dir;
      setPill({ edge, day: shiftDays(days[focusedIndex], dir) });
      // Instant snap — the strip follows the finger while the pill labels
      // the target day (matches the FlatList's `scrollToIndex(animated:false)`).
      // A task drag owns the strip now — any in-flight settle is over.
      setSettling(false);
      commitRoles(nextIndex);
      progress.value = -nextIndex * width;
      // Pin the carrier page at its touch-down position so the block stays
      // in the hand. On a prepend the carried page reindexes (focusedIndex →
      // focusedIndex + 1); otherwise it stays put.
      carrierIndexSV.value = targetIndex < 0 ? nextIndex : focusedIndex;
    },
    [commitRoles, days, focusedIndex, progress, width, carrierIndexSV],
  );

  // Arms the cross-day advance: lights the orange glow at the edge and starts
  // the hold timer. Called every frame the lifted block is in the zone — the
  // `armed` state (and `advancedRef`) make it idempotent.
  const handleDragEdge = useCallback(
    (edge: DragEdge) => {
      if (advancedRef.current) return;
      if (armedRef.current === edge) return;
      // Edge flip mid-hold: re-arm on the new edge.
      if (armedRef.current !== null && armTimerRef.current) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
      armedRef.current = edge;
      setArmed(edge);
      armTimerRef.current = setTimeout(() => {
        armTimerRef.current = null;
        advanceCrossDay(edge);
      }, CROSS_DAY_HOLD_MS);
    },
    [advanceCrossDay],
  );

  // Leaving the zone (or a fresh hold with no snap yet) disarms a pending
  // advance. Called every frame the lifted block is outside the zone.
  const handleDragEdgeExit = useCallback(() => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    armedRef.current = null;
    setArmed(null);
  }, []);

  const handleDragChange = useCallback(
    (active: boolean) => {
      setDragActive(active);
      // A task drag takes over the strip — release any settle lock.
      setSettling(false);
      if (active) {
        dayOffsetRef.current = 0;
        setPill(null);
        // Capture the page holding the lifted block so the pager can pin
        // it across strip snaps (carrierFix in PagerPage animatedStyle).
        carrierIndexSV.value = focusedIndex;
        carrierOriginSV.value = focusedIndex * width + progress.value;
        return;
      }
      // Gesture truly ended (`reportDragEnd` fires once at finalize — unlike
      // the `active === true` branch, which re-fires on every snap report).
      // Only here do we unlock the next gesture, clear a pending arm, and
      // unblock a fresh advance — anything mid-gesture must NOT reset these,
      // or holding the edge zone would never arm/advance reliably and the
      // once-per-gesture lock would leak a second advance (day 2 → day 3).
      advancedRef.current = false;
      if (armTimerRef.current) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
      armedRef.current = null;
      setArmed(null);
      carrierIndexSV.value = -1;
      carrierOriginSV.value = 0;
      // Drop: collapse back to the 7-day window around the day the drag
      // landed on, and commit it as the focused day.
      const landed = days[focusedIndex];
      if (!landed) return;
      const fresh = weekDays(landed);
      setDays(fresh);
      setFocusedIndex(dayIndexInWeek(landed));
      onFocusedDateChange(landed);
      setPill(null);
      commitRoles(dayIndexInWeek(landed));
      progress.value = -dayIndexInWeek(landed) * width;
    },
    [commitRoles, days, focusedIndex, onFocusedDateChange, progress, width, carrierIndexSV, carrierOriginSV],
  );

  const orangeRgb = isDarkColorScheme
    ? BRAND_ORANGE_DARK
    : BRAND_ORANGE_LIGHT;
  // Edge lit by either the armed glow or the post-advance pill (they agree:
  // the pill is set on advance while the same edge stays armed until exit).
  const edge = armed ?? pill?.edge ?? null;

  return (
    <View className="flex-1">
      <GestureDetector gesture={panGesture}>
        <View
          className="flex-1 overflow-hidden"
          onLayout={handleFirstLayout}
        >
          {days.map((day, index) => (
            <PagerPage
              key={dateKey(day)}
              index={index}
              width={width}
              progress={progress}
              fromSV={fromSV}
              toSV={toSV}
              draggingSV={draggingSV}
              carrierIndexSV={carrierIndexSV}
              carrierOriginSV={carrierOriginSV}
              borderColor={borderColor}
            >
              <DayTimeline
                date={day}
                showHeader={false}
                showEmptyGhostAlways
                refreshKey={reloadKey}
                onTaskPress={onTaskPress}
                onLongPress={onLongPress}
                dayOffsetRef={dayOffsetRef}
                onDragEdge={handleDragEdge}
                onDragEdgeExit={handleDragEdgeExit}
                onDragChange={handleDragChange}
                onCrossDayReschedule={() => onCrossDayReschedule()}
                onPeekChange={handlePeekChange}
              />
              {index < days.length - 1 && (
                <PeekStrip
                  blocks={peekByDay[dateKey(days[index + 1])] ?? []}
                />
              )}
            </PagerPage>
          ))}
        </View>
      </GestureDetector>

      {(armed || pill) && (
        <View pointerEvents="none" className="absolute inset-0 z-30">
          <LinearGradient
            colors={
              edge === "right"
                ? [`rgba(${orangeRgb}, 0)`, `rgba(${orangeRgb}, 0.34)`]
                : [`rgba(${orangeRgb}, 0.34)`, `rgba(${orangeRgb}, 0)`]
            }
            start={{
              x: edge === "right" ? 0 : 1,
              y: 0.5,
            }}
            end={{ x: edge === "right" ? 1 : 0, y: 0.5 }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 56,
              ...(edge === "right" ? { right: 0 } : { left: 0 }),
            }}
          />
          {pill && (
            <View
              style={{
                position: "absolute",
                top: 130,
                ...(pill.edge === "right" ? { right: 10 } : { left: 10 }),
              }}
            >
              <View className="flex-row items-center gap-1.5 rounded-full bg-brand-orange px-2.5 py-1 shadow-lg">
                {pill.edge === "right" ? (
                  <ChevronRight size={13} color="black" />
                ) : (
                  <ChevronLeft size={13} color="black" />
                )}
                <Text className="text-[11px] font-bold text-primary-foreground">
                  {format(pill.day, "EEE, MMM d")}
                </Text>
            </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}