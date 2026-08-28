import { ChevronLeft, ChevronRight } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { NAV_THEME } from "@/lib/constants";
import {
  getCrossDayOffset,
  resetCrossDayOffset,
  setCrossDayOffset,
} from "@/lib/cross-day-offset";
import { type PeekBlock } from "@/lib/peek";
import { useColorScheme } from "@/lib/useColorScheme";
import {
  centeredDays,
  dateKey,
  dayIndexInWeek,
  shiftDays,
  shiftWeek,
} from "@/lib/week-date-math";
import {
  OUTGOING_DIM_OPACITY,
  PARALLAX_FACTOR,
  SETTLE_MS,
  SETTLE_VELOCITY,
  SHADOW_STRIP_PX,
  computePagePosition,
  computeShadowStrip,
  computeWeekSlideTarget,
  decideSettleTarget,
  shouldSlideWeek,
} from "@/lib/week-pager-math";
import { format } from "date-fns";
import { LinearGradient } from "expo-linear-gradient";
import {
  type ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
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
import { DayTimeline } from "./day-timeline";
import { type DragEdge, PagerPage } from "./week-pager-page";
import { PEEK_STRIP_W, PeekStrip } from "./week-peek-strip";

/** Hold time (ms) a lifted block must sit in the screen-edge zone before the
 * cross-day advance fires (mockup's "lifted block at the edge → jumps"). */
const CROSS_DAY_HOLD_MS = 400;

/** `withTiming` config for every settle snap (and snap-back) after a swipe
 * ends — `SETTLE_MS` is shared with the Week header so the two land together. */
const SETTLE = {
  duration: SETTLE_MS,
  easing: Easing.out(Easing.cubic),
} as const;

const BRAND_ORANGE_LIGHT = "255, 142, 62";
const BRAND_ORANGE_DARK = "255, 122, 36";

interface WeekPagerProps {
  /** The day the screen/header currently shows; the pager keeps the focused
   * page aligned with it in both directions (swipe updates it, a chip tap
   * re-centers the pager on it). */
  focusedDate: Date;
  onFocusedDateChange: (day: Date) => void;
  /** Per-day refetch tokens (keyed by `dateKey`) forwarded to each page's
   * `DayTimeline` — a bump for a single day only refetches that page. */
  reloadKeyByDay: Record<string, number>;
  onSessionPress?: (taskId: string) => void;
  onLongPress?: (timeISO: string) => void;
  /** Fired after a cross-day reschedule so the screen can bump the target
   * day's reload token (the source day refetches itself). */
  onCrossDayReschedule: (taskId: string, startISO: string) => void;
  /** Strip offset shared value, owned by `WeekScreen`. The Week header reads
   * it so its chip strip tracks the pager 1:1 during a week slide, and its
   * own week-swipe writes it to drag this pager one page. */
  progressSV: SharedValue<number>;
  /** The header strip's own offset. The pager writes it (via `withTiming`)
   * only when a day-swipe crosses a week boundary (`slideWeek`), so the
   * header slides its week block in sync from rest. */
  headerStripSV: SharedValue<number>;
  /** A boundary-crossing day-swipe (`slideWeek`) started its animation — the
   * header enters week-slide mode. */
  onWeekSlideStart?: () => void;
  /** …and finished, in week direction `dir` — the header re-centers its strip
   * on the new week. */
  onWeekSlideEnd?: (dir: -1 | 1) => void;
}

/** Imperative surface the Week header drives during its own week swipe — see
 * `week-header.tsx`. The per-frame strip position is a plain shared-value
 * write; only these three lifecycle moments cross back into React. */
export type WeekPagerHandle = {
  /** Header week-swipe began: build the same-weekday adjacent-week window so
   * the page sliding in under the finger is the correct day. */
  beginHeaderWeekDrag: () => void;
  /** Header week-swipe committed in `dir` (−1 back, 1 forward): finish the
   * one-page slide with `withTiming` and re-center the window. */
  settleHeaderWeekDrag: (dir: -1 | 1) => void;
  /** Header week-swipe released below threshold or cancelled: collapse the
   * window back to `centeredDays(focused)` with no focus change. */
  abortHeaderWeekDrag: () => void;
};

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
function WeekPagerImpl(
  {
    focusedDate,
    onFocusedDateChange,
    reloadKeyByDay,
    onSessionPress,
    onLongPress,
    onCrossDayReschedule,
    progressSV,
    headerStripSV,
    onWeekSlideStart,
    onWeekSlideEnd,
  }: WeekPagerProps,
  ref: ForwardedRef<WeekPagerHandle>,
) {
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
  // 1 while the Week header owns the strip for its week swipe: the window is a
  // transient same-weekday `[f−7, f, f+7]`, `progress` is driven from the
  // header's pan, and the pager's own pan is disabled. Cleared when the
  // header's settle/abort re-centers the window.
  const [weekMode, setWeekMode] = useState(false);
  // Synchronous mirror of `weekMode` — read by the imperative handlers before
  // the state re-render lands (same reason as `crossDayDragRef`).
  const weekModeRef = useRef(false);
  // Synchronous guard for cross-day drag — prevents focusedDate effect
  // from rebuilding the window mid-drag (refs are immediately readable,
  // unlike state which requires a render cycle).
  const crossDayDragRef = useRef(false);
  // Each mounted day's mini-day blocks (from its DayTimeline's `onPeekChange`),
  // keyed by `dateKey`, so every page's strip renders the next day's real tasks.
  const [peekByDay, setPeekByDay] = useState<Record<string, PeekBlock[]>>({});

  // Strip offset in px. Rest value: `-width` — the focused page is always
  // the middle of the 3-page window. Owned by `WeekScreen` (so the Week
  // header can read it and drive it during a week swipe); aliased to
  // `progress` here so the rest of this file is untouched. `handleFirstLayout`
  // / the width-change effect in `WeekScreen` re-snap it.
  const progress = progressSV;
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
  const handlePeekChange = useCallback(
    (blocks: PeekBlock[], dayKey: string) => {
      setPeekByDay((prev) =>
        prev[dayKey] === blocks ? prev : { ...prev, [dayKey]: blocks },
      );
    },
    [],
  );

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
    if (!pendingSettleRef.current) return;
    pendingSettleRef.current = false;
    progress.value = -width;
  }, [days, progress, width]);

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
    },
    [centeredDays, commitRoles, days],
  );

  // ── Week slide (header-driven, or a day-swipe that crosses a week edge) ────
  //
  // Both paths animate `progress` exactly one page and, on the header path,
  // let the header's pan drive `progress` per-frame. The pager stays locked
  // (`settling` + `weekMode`) for the whole transition; `settleRoles`
  // re-centers the window at the end, deferring the `progress` snap to the
  // `[days]` layout-effect so the swap is invisible.

  // Header week-swipe began: swap the live window for a transient
  // same-weekday `[f−7, f, f+7]` so the page sliding in under the finger is
  // the correct day of the adjacent week. No `pendingSettleRef` — the header
  // owns the strip position until its settle/abort.
  const beginHeaderWeekDrag = useCallback(() => {
    if (settling || dragActive || weekModeRef.current) return;
    weekModeRef.current = true;
    const f = days[focusedIndex];
    setDays([shiftWeek(f, -1), f, shiftWeek(f, 1)]);
    setFocusedIndex(1);
    commitRoles(1);
    draggingSV.value = 1; // parallax held while the finger drags
    setWeekMode(true);
    setSettling(true);
  }, [settling, dragActive, days, focusedIndex, commitRoles, draggingSV]);

  // Completion of a header week slide: clear week mode and re-center the
  // window on `days[idx]` — the same-weekday adjacent-week day (`1 + dir`) on
  // a commit, or `f` (`1`) on an abort.
  const finishHeaderWeekRoles = useCallback(
    (idx: number) => {
      weekModeRef.current = false;
      setWeekMode(false);
      settleRoles(idx);
    },
    [settleRoles],
  );

  // Header week-swipe committed in `dir`: finish the one-page slide from
  // wherever the finger left `progress`, roles set for the whole slide.
  const settleHeaderWeekDrag = useCallback(
    (dir: -1 | 1) => {
      // `beginHeaderWeekDrag` bailed (pager was mid-settle) → let the pager's
      // own `focusedDate` effect handle the committed week change instead.
      if (!weekModeRef.current) return;
      toSV.value = 1 + dir;
      draggingSV.value = 0; // parallax eases back to 1x over the settle
      progress.value = withTiming(-width - dir * width, SETTLE, () => {
        "worklet";
        // Re-center on the committed week whether or not the tween finished
        // clean — `focusedDate` already moved, an interrupt just skips the
        // last frames.
        runOnJS(finishHeaderWeekRoles)(1 + dir);
      });
    },
    [toSV, draggingSV, progress, width, finishHeaderWeekRoles],
  );

  // Header week-swipe released below threshold, or cancelled: collapse the
  // transient window back to `centeredDays(f)`. Focus never changed, so the
  // `focusedDate` effect no-ops once `settleRoles` clears `settling`.
  const abortHeaderWeekDrag = useCallback(() => {
    if (!weekModeRef.current) return; // begin bailed — nothing to collapse
    draggingSV.value = 0;
    weekModeRef.current = false;
    setWeekMode(false);
    settleRoles(1);
  }, [draggingSV, settleRoles]);

  useImperativeHandle(
    ref,
    () => ({
      beginHeaderWeekDrag,
      settleHeaderWeekDrag,
      abortHeaderWeekDrag,
    }),
    [beginHeaderWeekDrag, settleHeaderWeekDrag, abortHeaderWeekDrag],
  );

  // Completion of the boundary-cross week slide (`slideWeek`): re-center the
  // pager window, then let the header re-center its strip on the new week.
  const finishSlideWeek = useCallback(
    (dir: 1 | -1) => {
      settleRoles(1 + dir);
      onWeekSlideEnd?.(dir);
    },
    [settleRoles, onWeekSlideEnd],
  );

  // Drives the initial center position (and a chip tap to a day in a week
  // that isn't mounted) with an explicit re-snap on first layout.
  const handleFirstLayout = useCallback(() => {
    if (hasLaidOutRef.current) return;
    hasLaidOutRef.current = true;
    requestAnimationFrame(() => {
      commitRoles(1);
      progress.value = -width;
    });
  }, [commitRoles, progress, width]);
  const snapTo = useCallback(
    (index: number, animated: boolean) => {
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
  // advancing one day). Animated as a one-page `withTiming` slide (was an
  // instant `progress = -width` cut), and the header runs its own week-block
  // slide in sync off `onWeekSlideStart` / `onWeekSlideEnd`. The destination
  // is the natural "next/previous day" past the boundary, not the same
  // weekday: forward past Sunday lands on Monday of next week; backward past
  // Monday lands on Sunday of previous week — the same place a slow drag
  // would have ended up after fully crossing the edge. The transient window
  // keeps the current focused day at index 1 with `nextFocused` as the
  // incoming neighbour (index `1 + dir`); `settleOn` already set `settling`,
  // so the `focusedDate` effect stays out of the way until `finishSlideWeek`
  // re-centers via `settleRoles`.
  const slideWeek = useCallback(
    (dir: 1 | -1) => {
      const current = days[focusedIndex];
      const nextFocused = computeWeekSlideTarget(current, dir);
      const win =
        dir === 1
          ? [days[0], current, nextFocused] // page 2 slides in from the right
          : [nextFocused, current, days[2]]; // page 0 slides in from the left
      setDays(win);
      setFocusedIndex(1);
      fromSV.value = 1;
      toSV.value = 1 + dir;
      draggingSV.value = 0;

      onFocusedDateChange(nextFocused); // focus commits now; effect guarded by `settling`
      onWeekSlideStart?.(); // header enters week-slide mode

      const target = -width - dir * width;
      headerStripSV.value = withTiming(target, SETTLE); // header strip from REST
      progress.value = withTiming(target, SETTLE, () => {
        "worklet";
        runOnJS(finishSlideWeek)(dir);
      });
    },
    [
      days,
      focusedIndex,
      fromSV,
      toSV,
      draggingSV,
      onFocusedDateChange,
      onWeekSlideStart,
      headerStripSV,
      progress,
      width,
      finishSlideWeek,
    ],
  );
  const settleOn = useCallback(
    (target: number, flicked: boolean) => {
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
  // Disabled while a task drag is active (`dragActive`), a settle is running
  // (`settling`), or the Week header owns the strip for its week swipe
  // (`weekMode`) — each owns the strip.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!dragActive && !settling && !weekMode)
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
    [dragActive, settling, weekMode, focusedIndex, width, handlePanEnd],
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
  const orangeRgb = isDarkColorScheme ? BRAND_ORANGE_DARK : BRAND_ORANGE_LIGHT;
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
        <View className="flex-1 overflow-hidden" onLayout={handleFirstLayout}>
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
                onSessionPress={onSessionPress}
                onLongPress={onLongPress}
                onDragEdge={handleDragEdge}
                onDragEdgeExit={handleDragEdgeExit}
                onDragChange={handleDragChange}
                onCrossDayReschedule={onCrossDayReschedule}
                onPeekChange={handlePeekChange}
              />
              {index < days.length - 1 && (
                <PeekStrip blocks={peekByDay[dateKey(days[index + 1])] ?? []} />
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

export const WeekPager = forwardRef(WeekPagerImpl);
WeekPager.displayName = "WeekPager";
