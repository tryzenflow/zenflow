import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { format } from "date-fns";
import { Text } from "@/components/ui/text";
import { ChevronLeft, ChevronRight } from "@/components/Icons";
import { useColorScheme } from "@/lib/useColorScheme";
import { NAV_THEME } from "@/lib/constants";
import {
  centeredDays,
  dateKey,
  dayIndexInWeek,
  shiftDays,
} from "@/lib/week-date-math";
import {
  decideSettleTarget,
  computePagePosition,
  computeShadowStrip,
  computeWeekSlideTarget,
  PARALLAX_FACTOR,
  OUTGOING_DIM_OPACITY,
  SHADOW_STRIP_PX,
  SETTLE_VELOCITY,
  shouldSlideWeek,
} from "@/lib/week-pager-math";
import { DayTimeline } from "./day-timeline";
import { DAY_MINUTES, type PeekBlock } from "@/lib/peek";
import { debugLog } from "@/lib/debug-log";
import {
  getCrossDayOffset,
  setCrossDayOffset,
  resetCrossDayOffset,
} from "@/lib/cross-day-offset";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  clamp,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

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
  debugLog("pager.peekstrip.mount", { blocksCount: blocks.length });
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
  /** Strip offset in px (rest: `-width` — the focused page is always the
   * middle of the 3-page window). */
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
  debugLog("pager.page.mount", { index, width });
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

  // The stack shadow is drawn as an explicit gradient strip at the incoming
  // page's leading edge (over the outgoing page) — see `computeShadowStrip`.
  // A native box-shadow can't reproduce the mockup's hard-edged band on web
  // (RN Web supports no `spread`), so the strip lives in the WeekPager's
  // top overlay, outside the `overflow-hidden` strip container, and animates
  // its opacity + position from the same shared values.
  return (
    <Animated.View
      style={[
        { position: "absolute", left: 0, top: 0, bottom: 0, width },
        animatedStyle,
      ]}
      collapsable={false}
    >
      {children}
    </Animated.View>
  );
}

interface WeekPagerProps {
  /** The day the screen/header currently shows; the pager keeps the focused
   * page aligned with it in both directions (swipe updates it, a chip tap
   * re-centers the pager on it). */
  focusedDate: Date;
  onFocusedDateChange: (day: Date) => void;
  /** Per-day refetch tokens (keyed by `dateKey`) forwarded to each page's
   * `DayTimeline` — a bump for a single day only refetches that page. */
  reloadKeyByDay: Record<string, number>;
  onTaskPress?: (taskId: string) => void;
  onLongPress?: (timeISO: string) => void;
  /** Fired after a cross-day reschedule so the screen can bump the target
   * day's reload token (the source day refetches itself). */
  onCrossDayReschedule: (taskId: string, startISO: string) => void;
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
 * The data window is a live centered 3-page strip — always the focused day
 * with its two neighbors (`centeredDays`), focused index constant at 1 — so
 * a swipe settles onto a page that is already mounted, and React recycles
 * the surviving pages by their `dateKey` (no remount/refetch for the pages
 * that stay; exactly one new page mounts and fetches per settle). A swipe
 * that escapes a week edge (Monday swiped backward, Sunday swiped forward)
 * slides the whole window one week (`slideWeek`); a cross-day task drag
 * re-centers the window on the advanced day, keeping the page holding the
 * lifted block mounted for the whole gesture (GitHub issue #19's "cross-day
 * drag" frame).
 */
export function WeekPager({
  focusedDate,
  onFocusedDateChange,
  reloadKeyByDay,
  onTaskPress,
  onLongPress,
  onCrossDayReschedule,
}: WeekPagerProps) {
  debugLog("pager.mount", { focusedDate: dateKey(focusedDate) });
  const { width } = useWindowDimensions();
  const { isDarkColorScheme } = useColorScheme();
  const borderColor = isDarkColorScheme
    ? NAV_THEME.dark.border
    : NAV_THEME.light.border;

  // The live window: always the focused day centered between its two
  // neighbors. The focused page is therefore ALWAYS index 1 — rest is
  // `progress = -width` and the settle can never escape the window (a
  // week jump is gated separately by `shouldSlideWeek`).
  const [days, setDays] = useState<Date[]>(() => centeredDays(focusedDate));
  const [focusedIndex, setFocusedIndex] = useState(1);
  const [dragActive, setDragActive] = useState(false);
  const [pill, setPill] = useState<{ edge: DragEdge; day: Date } | null>(null);
  // 1 while a settle (or snap-back) animation is running: the pan is disabled
  // so a new gesture can't touch down mid-flight and clobber the settle's
  // roles/position — which used to flip the incoming/outgoing z-order mid-
  // swipe (the "next day stops covering the current day" glitch).
  const [settling, setSettling] = useState(false);
  const releaseSettle = useCallback(() => setSettling(false), []);
  // Synchronous guard for cross-day drag — prevents focusedDate effect
  // from rebuilding the window mid-drag (refs are immediately readable,
  // unlike state which requires a render cycle).
  const crossDayDragRef = useRef(false);
  // Each mounted day's mini-day blocks (from its DayTimeline's `onPeekChange`),
  // keyed by `dateKey`, so every page's strip renders the next day's real tasks.
  const [peekByDay, setPeekByDay] = useState<Record<string, PeekBlock[]>>({});

  // Strip offset in px. Rest value: `-width` — the focused page is always
  // the middle of the 3-page window. Initialized from the first render's
  // focus so the window mounts showing the right day even before the first
  // layout (the FlatList's unreliable `initialScrollIndex` workaround is
  // gone; `handleFirstLayout` re-snaps as a safety net).
  const progress = useSharedValue(-width);
  // Roles the pages' animated styles derive from (see PagerPage).
  const fromSV = useSharedValue(1);
  const toSV = useSharedValue(1);
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
  // Edge whose cross-day advance is armed (orange glow lit, hold timer
  // running) — null when no zone is active or the advance already fired.
  // Kept as a shared value (not React state) so arming/disarming never
  // re-renders the pager — a re-render would recreate the TaskBlock gesture
  // handler and reset its `isDragging`, silently killing the edge-exit
  // detection (the "glow won't clear when dragging back to center" bug).
  const armedEdgeSV = useSharedValue<DragEdge | null>(null);

  // Stable identity so DayTimeline's peek-report effect doesn't re-fire on
  // every pager render.
  const handlePeekChange = useCallback((blocks: PeekBlock[], dayKey: string) => {
    debugLog("pager.peek.change", { dayKey, blocksCount: blocks.length });
    setPeekByDay((prev) =>
      prev[dayKey] === blocks ? prev : { ...prev, [dayKey]: blocks },
    );
  }, []);

  // Cross-day offset accumulated during a drag; TaskBlock reads it via the
  // module-level `getCrossDayOffset()` (not a useRef prop — Reanimated would
  // freeze a ref captured by a worklet closure).
  // Replaced by cross-day-offset module — see import above.
  // Gates the cross-day advance to exactly once per drag gesture (the strip
  // must not chain days while a finger holds past the carry threshold).
  const advancedRef = useRef(false);
  // Pending arm-timer for the cross-day hold, cleared on exit/drop/unmount.
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLaidOutRef = useRef(false);
  // The day the drag started on — captured once at drag start so cross-day
  // offset is applied relative to the original day, not the re-centered window.
  const dragStartDayRef = useRef<Date | null>(null);
  // True while a task-drag gesture is live. Unlike `dragActive` (async React
  // state), this ref is written synchronously inside `handleDragChange`, so
  // the false→true transition — the only place the carrier pin and the day
  // offset may be (re)captured — is detected race-free.
  const dragActiveRef = useRef(false);

  // Set true by `settleRoles` when it queues a re-center (days + focusedIndex
  // updated, progress snap deferred). The `useLayoutEffect` on `[days]`
  // snaps progress to `-width` after React commits the new days array,
  // avoiding a one-frame flash where the old `days` renders with
  // `progress = -width` and the old focused day lands at center
  // (index 1 * w + (-w) = 0).
  const pendingSettleRef = useRef(false);

  useLayoutEffect(() => {
    debugLog("pager.progress.snap", { pending: pendingSettleRef.current, days: days.map(dateKey), width });
    if (!pendingSettleRef.current) return;
    pendingSettleRef.current = false;
    progress.value = -width;
  }, [days, progress, width]);

  useEffect(
    () => () => {
      debugLog("pager.cleanup", { armTimer: !!armTimerRef.current });
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );

  const commitRoles = useCallback(
    (index: number) => {
      debugLog("pager.roles.commit", { index });
      fromSV.value = index;
      toSV.value = index;
    },
    [fromSV, toSV],
  );

  // Re-centers the 3-page window on the settled day and unlocks the pan —
  // the default end of a settle that lands on a neighbor (swipe settle or
  // chip-tap slide). Called from the settle animation's completion callback
  // (via `runOnJS`) — never mid-animation — so the pages' animated styles
  // keep the swipe's outgoing/incoming roles for the whole slide. The
  // incoming page sits at screen x=0 when the animation ends
  // (progress = `-target * width`); re-centering it to the middle slot
  // (`focusedIndex 1`, `progress = -width`) leaves it exactly where the
  // animation put it, and the other two pages are off-screen either way.
  // Also clears the outgoing/incoming roles to `focusedIndex` so the next
  // `onBegin` starts from a clean slate (otherwise the stale roles from
  // the just-completed animation leave the new "incoming" page at zIndex 9
  // in its off-screen slot, and the next `onBegin` is the only thing that
  // resets them — if `onBegin` doesn't fire for any reason, the visual is
  // stuck).
  const settleRoles = useCallback(
    (target: number) => {
      const landed = days[target];
      if (!landed) return;
      setSettling(false);
      // onFocusedDateChange is called in settleOn *before* the settle
      // animation starts, so the header chip updates immediately.
      // Defer the progress snap to the useLayoutEffect on `[days]` so it
      // fires after React commits the new days array — avoids the
      // one-frame flash where the old days render with progress=-w
      // (old focused day lands at center: index 1 * w + (-w) = 0).
      pendingSettleRef.current = true;
      setDays(centeredDays(landed));
      setFocusedIndex(1);
      commitRoles(1);
      debugLog("pager.settle.land", { day: dateKey(landed), target });
    },
    [centeredDays, commitRoles, days],
  );

  // Drives the initial center position (and a chip tap to a day in a week
  // that isn't mounted) with an explicit re-snap on first layout.
  const handleFirstLayout = useCallback(() => {
    if (hasLaidOutRef.current) return;
    hasLaidOutRef.current = true;
    debugLog("pager.layout.first", { width });
    requestAnimationFrame(() => {
      commitRoles(1);
      progress.value = -width;
    });
  }, [commitRoles, progress, width]);

  const snapTo = useCallback(
    (index: number, animated: boolean) => {
      debugLog("pager.snap.to", { index, animated, targetProgress: -index * width });
      if (animated) {
        progress.value = withTiming(
          -index * width,
          { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (!finished) {
              runOnJS(releaseSettle)();
              return;
            }
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
  // outgoing/incoming roles set for the whole slide, then re-centers the
  // window on the target (via `onDone`, or the default `settleRoles`). The
  // roles must land exactly on the centered index or the resting page would
  // keep its stack chrome (see PagerPage's `sliding` gate, which keys off
  // `m`).
  const animateRolesTo = useCallback(
    (target: number, onDone?: (index: number) => void) => {
      debugLog("pager.animate.roles", { from: focusedIndex, to: target, width });
      fromSV.value = focusedIndex;
      toSV.value = target;
      progress.value = withTiming(
        -target * width,
        { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (!finished) {
            runOnJS(releaseSettle)();
            return;
          }
          runOnJS(onDone ?? settleRoles)(target);
        },
      );
    },
    [focusedIndex, fromSV, toSV, progress, settleRoles, width, releaseSettle],
  );

  // External focus change (WeekHeader chip tap): scroll to the day if it's in
  // the window, otherwise rebuild the window around it. Internal changes
  // (swipe settle, drag advance/drop) already keep `days`/`focusedIndex` in
  // sync, so their re-entry here is a no-op (matching index, or the day is in
  // the freshly rebuilt window). Guarded by `settling` so a swipe settle's
  // `onFocusedDateChange(landed)` (which fires *before* the settle animation)
  // doesn't re-enter here and call `animateRolesTo` again — that replaces the
  // in-flight animation with one driven by a stale `days`/`focusedIndex`
  // closure, the old callback fires `finished: false` and skips
  // `settleRoles`, and the chain breaks after a few swipes (the pager stops
  // responding). The settle itself updates `focusedDate` via the parent's
  // `setFocusedDate`, but the effect must not interfere.
  useEffect(() => {
    // Guard against cross-day drag window rebuild (synchronous ref check)
    if (crossDayDragRef.current) return;
    debugLog("pager.focus.change", { focusedDate: dateKey(focusedDate), settling, days: days.map(dateKey), focusedIndex });
    if (settling) return;
    const key = dateKey(focusedDate);
    const idx = days.findIndex((d) => dateKey(d) === key);
    if (idx >= 0) {
      if (idx === focusedIndex) return;
      // Only an adjacent-day tap animates the stack slide (outgoing
      // parallaxes out, tapped day stacks in). The 3-page window always
      // contains the focused day's two neighbors, so a match is always
      // exactly one page away.
      // Lock the pan for the duration of the slide (same serialization as
      // a swipe settle — an interrupt must not flip the cover mid-animation).
      setSettling(true);
      animateRolesTo(idx);
      return;
    }
    // Day outside the window (a header week jump): rebuild the centered
    // window around it and snap straight to rest. Multi-slot jumps would
    // sweep through an empty viewport — the pager paints only the outgoing/
    // incoming pair — so those snap straight to the target day.
    const fresh = centeredDays(focusedDate);
    setDays(fresh);
    setFocusedIndex(1);
    setSettling(false);
    commitRoles(1);
    snapTo(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the
    // current window; only the focused day drives this.
  }, [focusedDate, settling]);

  // Slides the focused day a full week (the response to a swipe that escapes
  // a week edge: Monday swiped backward, Sunday swiped forward — a fast
  // fling past the edge, so the pager jumps the whole week rather than
  // advancing one day). Instant, matching the old FlatList's
  // `scrollToIndex(animated: false)`. The destination is the natural
  // "next/previous day" past the boundary, not the same weekday: forward past
  // Sunday lands on Monday of next week; backward past Monday lands on
  // Sunday of previous week — the same place a slow drag would have ended up
  // after fully crossing the edge. The neighbor that was sliding in survives
  // the swap by key (it stays in the re-centered window), so only the two
  // new far neighbors mount; the fresh window gets its roles committed so
  // the pages render at full opacity on their slots — otherwise none of them
  // matches the old window's outgoing/incoming indexes and the grid renders
  // invisible (opacity 0).
  const slideWeek = useCallback(
    (dir: 1 | -1) => {
      const nextFocused = computeWeekSlideTarget(days[focusedIndex], dir);
      const fresh = centeredDays(nextFocused);
      setDays(fresh);
      setFocusedIndex(1);
      onFocusedDateChange(nextFocused);
      commitRoles(1);
      progress.value = -width;
      setSettling(false);
      debugLog("pager.week.slide", { dir, day: dateKey(nextFocused) });
    },
    [
      centeredDays,
      commitRoles,
      days,
      focusedIndex,
      onFocusedDateChange,
      progress,
      width,
    ],
  );

  const settleOn = useCallback(
    (target: number, flicked: boolean) => {
      debugLog("pager.settle.on", { target, flicked, focusedIndex, days: days.map(dateKey) });
      // Lock the pan for the duration of the settle so an interrupt can't
      // flip the incoming/outgoing cover mid-animation.
      setSettling(true);
      if (target === focusedIndex) {
        // Stayed on the page — spring back to rest.
        snapTo(focusedIndex, true);
        return;
      }
      const dir = target < focusedIndex ? -1 : 1;
      // A week edge only jumps on a decisive flick — a slow deliberate drag
      // from Monday/Sunday still settles on the neighbor day.
      if (shouldSlideWeek(dayIndexInWeek(days[focusedIndex]), dir, flicked)) {
        slideWeek(dir);
        return;
      }
      // Commit the focus *before* the settle animation starts so the
      // header chip/title updates immediately — previously it only
      // updated at animation end (inside `settleRoles`), causing the
      // header to flash back to the previous day for 200 ms.
      const landed = days[target];
      if (landed) onFocusedDateChange(landed);
      animateRolesTo(target, settleRoles);
    },
    [
      animateRolesTo,
      dayIndexInWeek,
      days,
      focusedIndex,
      settleRoles,
      shouldSlideWeek,
      slideWeek,
      snapTo,
    ],
  );

  const handlePanEnd = useCallback(
    (dragPx: number, velocityX: number) => {
      debugLog("pager.pan.end", { dragPx, velocityX, focusedIndex, width });
      const target = decideSettleTarget({
        dragPx,
        velocityX,
        startIndex: focusedIndex,
        dayCount: days.length,
        width,
      });
      settleOn(target, Math.abs(velocityX) >= SETTLE_VELOCITY);
    },
    [days.length, focusedIndex, settleOn, width],
  );

  // Memoized to prevent handler re-attachment on unrelated renders.
  // `activeOffsetX` keeps it a pure horizontal pager: vertical drags fail it
  // (`failOffsetY`) and fall through to the day pages' own ScrollViews, the
  // same split the FlatList gave us. The 12px activation threshold is
  // deliberately ABOVE TaskBlock's 10px `activeOffsetX` (task-block.tsx), so
  // a gesture starting on a task block activates the block's pan first and
  // fails this one — the pager is effectively locked while a block is touched.
  // Disabled while a task drag is active (`dragActive`) or a settle is running
  // (`settling`) — both own the strip.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
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
        }),
    [dragActive, settling, focusedIndex, width, handlePanEnd],
  );

  // Fires after a lifted block has held in the edge zone for the hold time.
  // Exactly one advance per drag gesture — holding longer never chains days.
  // The window change is DEFERRED until drop: re-centering now would remount
  // `TaskBlock`s and recreate their `Gesture.Pan()` handlers, cancelling the
  // active drag mid-gesture (RNGH cancels the old handler when a new one is
  // mounted over it — `onFinalize` fires, `isDragging` resets to 0, and
  // `handleDragChange(false)` releases the carrier pin, sending the lifted
  // block off-screen). So during the cross-day drag the window stays put:
  // the carrier page (source day, still at focusedIndex=1) keeps the lifted
  // block mounted and the gesture alive. Only the day-offset (read by
  // `TaskBlock.handleDragEnd` on drop), the header chip, and the pill label
  // update now. The window re-centers on the target day inside
  // `handleDragChange(false)`, after the gesture fully releases.
  const advanceCrossDay = useCallback(
    (edge: DragEdge) => {
      if (advancedRef.current) return;
      advancedRef.current = true;

      const dir = edge === "right" ? 1 : -1;
      const targetDay = shiftDays(days[focusedIndex], dir);
      setCrossDayOffset(getCrossDayOffset() + dir);
      setPill({ edge, day: targetDay });
      // Commit the focus the moment the advance fires, so the WeekHeader
      // chip/title move in sync with the strip snap. The pager window
      // follows on drop (see comment above).
      // Guard the focusedDate effect to prevent window rebuild mid-drag.
      crossDayDragRef.current = true;
      onFocusedDateChange(targetDay);
      debugLog("pager.advance", {
        edge,
        target: dateKey(targetDay),
        dayOffset: getCrossDayOffset(),
        carrierIndex: focusedIndex,
      });
    },
    [days, focusedIndex, onFocusedDateChange, shiftDays],
  );

  // Arms the cross-day advance: lights the orange glow at the edge and starts
  // the hold timer. Called every frame the lifted block is in the zone — the
  // shared value (and `advancedRef`) make it idempotent.
  const handleDragEdge = useCallback(
    (edge: DragEdge) => {
      if (advancedRef.current) return;
      // Already armed for this exact edge with a pending timer — no-op.
      if (armedEdgeSV.value === edge && armTimerRef.current) return;
      // Edge flip mid-hold: clear the old timer and re-arm on the new edge.
      if (armTimerRef.current) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
      armedEdgeSV.value = edge;
      debugLog("pager.edge.arm", { edge });
      armTimerRef.current = setTimeout(() => {
        armTimerRef.current = null;
        advanceCrossDay(edge);
      }, CROSS_DAY_HOLD_MS);
    },
    [advanceCrossDay, armedEdgeSV],
  );

  // Leaving the zone (or a fresh hold with no snap yet) disarms a pending
  // advance. Called every frame the lifted block is outside the zone.
  const handleDragEdgeExit = useCallback(() => {
    if (armTimerRef.current === null && armedEdgeSV.value === null) return;
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    armedEdgeSV.value = null;
    debugLog("pager.edge.disarm", {});
    setPill(null);
  }, [armedEdgeSV]);

  const handleDragChange = useCallback(
    (active: boolean) => {
      if (active) {
        // Only the FIRST report of a drag starts it. `onDragChange(true)`
        // re-fires on every vertical snap change while the block is lifted
        // (day-timeline reports each snap), and re-running the capture below
        // would wipe the cross-day offset (the accumulated day offset a fired advance
        // accumulated) and re-pin the carrier to the NEW focused page —
        // unpinning the page that actually holds the lifted block mid
        // cross-day drag (the block flies off-screen and the drop lands on
        // the source day). Once started, a drag keeps its pin and offset.
        if (dragActiveRef.current) return;
        dragActiveRef.current = true;
        // Capture the drag start day BEFORE resetting cross-day offset
        dragStartDayRef.current = days[focusedIndex];
        setDragActive(true);
        // A task drag takes over the strip — release any settle lock.
        setSettling(false);
        resetCrossDayOffset();
        setPill(null);
        // Capture the page holding the lifted block so the pager can pin
        // it across strip snaps (carrierFix in PagerPage animatedStyle).
        carrierIndexSV.value = focusedIndex;
        carrierOriginSV.value = focusedIndex * width + progress.value;
        debugLog("pager.drag.start", {
          day: dateKey(days[focusedIndex]),
          days: days.map(dateKey),
          carrierIndex: focusedIndex,
          dayOffset: getCrossDayOffset(),
        });
        return;
      }
      dragActiveRef.current = false;
      setDragActive(false);
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
      armedEdgeSV.value = null;
      carrierIndexSV.value = -1;
      carrierOriginSV.value = 0;
      // Drop: re-center the 3-page window on the day the drag landed on.
      // A cross-day advance deferred the window change to here — apply it
      // now via the accumulated day offset relative to the ORIGINAL drag day,
      // not the re-centered window's focused day.
      const dayOffset = getCrossDayOffset();
      const startDay = dragStartDayRef.current;
      dragStartDayRef.current = null;
      if (!startDay) return;
      const landed = shiftDays(startDay, dayOffset);
      if (!landed) return;
      debugLog("pager.drag.end", {
        landed: dateKey(landed),
        dayOffset,
      });
      const fresh = centeredDays(landed);
      setDays(fresh);
      setFocusedIndex(1);
      onFocusedDateChange(landed);
      setPill(null);
      commitRoles(1);
      progress.value = -width;
      // Release cross-day drag guard — window re-centered, safe to rebuild now.
      crossDayDragRef.current = false;
    },
    [
      centeredDays,
      commitRoles,
      days,
      focusedIndex,
      onFocusedDateChange,
      progress,
      width,
      carrierIndexSV,
      carrierOriginSV,
      shiftDays,
    ],
  );

  const orangeRgb = isDarkColorScheme
    ? BRAND_ORANGE_DARK
    : BRAND_ORANGE_LIGHT;
  // Glow overlays are always mounted; each gradient's opacity is driven by
  // `armedEdgeSV` (a shared value) so arming/disarming never re-renders
  // React — a re-render would recreate the TaskBlock gesture handler and
  // reset its `isDragging`, silently killing the edge-exit detection.
  const rightGlowStyle = useAnimatedStyle(() => ({
    opacity: armedEdgeSV.value === "right" ? 1 : 0,
  }));
  const leftGlowStyle = useAnimatedStyle(() => ({
    opacity: armedEdgeSV.value === "left" ? 1 : 0,
  }));

  // Seam shadow strip: an explicit gradient drawn at the incoming page's
  // leading edge, over the outgoing page. Lives in this overlay (outside the
  // `overflow-hidden` strip container, above every page) so it can never be
  // clipped and matches the mockup's hard-edged card shadow on web + native.
  // One strip per swipe direction — each only lights when its day slides in.
  // Both strips read the same `computeShadowStrip` output via a single
  // derived shared value — halves the per-frame worklet executions (was
  // running the pure function twice, once per `useAnimatedStyle`).
  const shadowStrip = useDerivedValue(() =>
    computeShadowStrip({
      progress: progress.value,
      outIndex: fromSV.value,
      toIndex: toSV.value,
      width,
    }),
  );
  const nextDayShadowStyle = useAnimatedStyle(() => {
    const strip = shadowStrip.value;
    return {
      left: strip.seamX - SHADOW_STRIP_PX,
      opacity: strip.nextDayOpacity,
    };
  });
  const prevDayShadowStyle = useAnimatedStyle(() => {
    const strip = shadowStrip.value;
    return {
      left: strip.seamX + width,
      opacity: strip.prevDayOpacity,
    };
  });

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
                refreshKey={reloadKeyByDay[dateKey(day)] ?? 0}
                onTaskPress={onTaskPress}
                onLongPress={onLongPress}
                onDragEdge={handleDragEdge}
                onDragEdgeExit={handleDragEdgeExit}
                onDragChange={handleDragChange}
                onCrossDayReschedule={onCrossDayReschedule}
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

      <View pointerEvents="none" className="absolute inset-0 z-30">
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              width: SHADOW_STRIP_PX,
            },
            nextDayShadowStyle,
          ]}
        >
          <LinearGradient
            colors={["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 1)"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              width: SHADOW_STRIP_PX,
            },
            prevDayShadowStyle,
          ]}
        >
          <LinearGradient
            colors={["rgba(0, 0, 0, 1)", "rgba(0, 0, 0, 0)"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, rightGlowStyle]}>
          <LinearGradient
            colors={[`rgba(${orangeRgb}, 0)`, `rgba(${orangeRgb}, 0.34)`]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 56,
              right: 0,
            }}
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, leftGlowStyle]}>
          <LinearGradient
            colors={[`rgba(${orangeRgb}, 0.34)`, `rgba(${orangeRgb}, 0)`]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 56,
              left: 0,
            }}
          />
        </Animated.View>
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
    </View>
  );
}