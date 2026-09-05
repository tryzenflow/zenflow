import { NAV_THEME } from "@/lib/constants";
import type { PeekBlock } from "@/lib/peek";
import { useColorScheme } from "@/lib/useColorScheme";
import {
  centeredDays,
  dateKey,
  dayIndexInWeek,
  shiftDays,
  shiftWeek,
} from "@/lib/week-date-math";
import {
  SETTLE_MS,
  SETTLE_VELOCITY,
  SHADOW_STRIP_PX,
  computePagePosition,
  computeShadowStrip,
  computeWeekSlideTarget,
  decideSettleTarget,
  shouldSlideWeek,
} from "@/lib/week-pager-math";
import type { Session } from "@zenflow/shared";
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
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { DayTimeline, type TimelineState } from "./day-timeline";
import type {
  PendingSessionUpdate,
  UpdateRecurringScope,
} from "./update-recurring-sheet";
import { type DragEdge, PagerPage } from "./week-pager-page";
import { PEEK_STRIP_W, PeekStrip } from "./week-peek-strip";

/** `withTiming` config for every settle snap (and snap-back) after a swipe
 * ends — `SETTLE_MS` is shared with the Week header so the two land together. */
const SETTLE = {
  duration: SETTLE_MS,
  easing: Easing.out(Easing.cubic),
} as const;

/** Day-navigation edge-hold: while a horizontal *navigation* drag (not a block
 * drag) is held with the finger inside `NAV_EDGE_ZONE` of a screen edge, the
 * focused day advances one step every `NAV_HOLD_MS` and the strip re-centres on
 * it — so a single held drag can walk several days, the header label leading
 * and the day content chasing it. This is week *navigation*; there is no longer
 * a block cross-day drag (moving a block to another day is the "Move to…"
 * sheet — long-press a block). */
const NAV_EDGE_ZONE = 56;
const NAV_HOLD_MS = 340;
const BRAND_ORANGE_LIGHT = "255, 142, 62";
const BRAND_ORANGE_DARK = "255, 122, 36";

/** Stable empty peek list — a fresh `[]` each render would re-run the strip's
 * memo for nothing. */
const EMPTY_PEEK: PeekBlock[] = [];

interface WeekPagerProps {
  /** The day the screen/header currently shows; the pager keeps the focused
   * page aligned with it in both directions (swipe updates it, a chip tap
   * re-centers the pager on it). */
  focusedDate: Date;
  onFocusedDateChange: (day: Date) => void;
  /** Fired continuously *during* a swipe with the day (or, in a header week
   * drag, the same-weekday day of the week) the strip is currently centred
   * on — before it's committed. `WeekScreen` binds the header's title / range
   * / highlighted chip to this so they track the finger, the way Month view's
   * `visibleMonth` does. Settling reconciles it back to `focusedDate`. */
  onVisibleDateChange?: (day: Date) => void;
  /** Global refetch tick — bumped on every screen focus so every mounted day
   * re-syncs (forwarded to each page's `DayTimeline` as its `refreshKey`). */
  focusTick: number;
  onSessionPress?: (taskId: string) => void;
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
  /** Load state of the focused page only — the pre-mounted neighbours must not
   * drive the screen's FAB. */
  onActiveStateChange?: (state: TimelineState) => void;
  /** Fired when a still-finger long-press on a block asks to move it — the
   * screen opens the "Move to…" sheet with this session. Forwarded straight
   * through from the active `DayTimeline`. */
  onRequestReschedule?: (session: Session) => void;
  /** Same-shaped scope-confirmation deferral as `DayTimeline`'s own prop —
   * plain passthrough to the active `DayTimeline`. */
  onRequestScopedUpdate?: (
    session: Session,
    pending: PendingSessionUpdate,
    onResolve: (
      choice: {
        scope: UpdateRecurringScope;
        skipConflicting: boolean;
      } | null,
    ) => void,
  ) => void;
  /** Session id to pulse on the focused day — a teleport target. Forwarded to
   * the active `DayTimeline` only. */
  flashSessionId?: string | null;
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
 * slides the whole window one week (`slideWeek`). Task blocks can be dragged
 * vertically to reschedule within their day; moving one to another day is done
 * through the "Move to…" sheet (long-press a block → `onRequestReschedule`),
 * not by dragging it off a screen edge.
 */
function WeekPagerImpl(
  {
    focusedDate,
    onFocusedDateChange,
    onVisibleDateChange,
    focusTick,
    onSessionPress,
    progressSV,
    headerStripSV,
    onWeekSlideStart,
    onWeekSlideEnd,
    onActiveStateChange,
    onRequestReschedule,
    onRequestScopedUpdate,
    flashSessionId = null,
  }: WeekPagerProps,
  ref: ForwardedRef<WeekPagerHandle>,
) {
  const { width } = useWindowDimensions();
  const { isDarkColorScheme } = useColorScheme();
  const borderColor = isDarkColorScheme
    ? NAV_THEME.dark.border
    : NAV_THEME.light.border;
  const orangeRgb = isDarkColorScheme ? BRAND_ORANGE_DARK : BRAND_ORANGE_LIGHT;

  // The live window: always the focused day centered between its two
  // neighbors. The focused page is therefore ALWAYS index 1 — rest is
  // `progress = -width` and the settle can never escape the window (a
  // week jump is gated separately by `shouldSlideWeek`).
  const [days, setDays] = useState<Date[]>(() => centeredDays(focusedDate));
  const [focusedIndex, setFocusedIndex] = useState(1);
  const [dragActive, setDragActive] = useState(false);
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
  // the state re-render lands.
  const weekModeRef = useRef(false);

  // Strip offset in px. Rest value: `-width` — the focused page is always
  // the middle of the 3-page window. Owned by `WeekScreen` (so the Week
  // header can read it and drive it during a week swipe); aliased to
  // `progress` here so the rest of this file is untouched. `handleFirstLayout`
  // / the width-change effect in `WeekScreen` re-snap it.
  const progress = progressSV;

  // Mirror of the live window for the UI-thread reaction below (a worklet
  // can't read React state, and `days` is an array of `Date`s, not a
  // shared value).
  const daysRef = useRef(days);
  daysRef.current = days;

  // Report the day the strip is centred on *as it moves* — once per whole-page
  // crossing — so `WeekScreen` can let the header title / range / chip track
  // the finger instead of jumping only when the swipe settles. At rest
  // `progress === -width` → index 1 (the focused page); a leftward drag pulls
  // it toward index 2 (next day), rightward toward 0 (previous). During a
  // header week drag the window is `[f−7, f, f+7]`, so the same math reports
  // the adjacent week with no special-casing. Settling walks the index back to
  // 1, reconciling the visible day to `focusedDate` for free.
  const emitVisibleDay = useCallback(
    (index: number) => {
      const day = daysRef.current[index];
      if (day) onVisibleDateChange?.(day);
    },
    [onVisibleDateChange],
  );
  useAnimatedReaction(
    () => Math.round(-progress.value / width),
    (index, prev) => {
      if (prev != null && index !== prev) runOnJS(emitVisibleDay)(index);
    },
    [width, emitVisibleDay],
  );

  // Roles the pages' animated styles derive from (see PagerPage).
  const fromSV = useSharedValue(1);
  const toSV = useSharedValue(1);
  const draggingSV = useSharedValue(0);
  // 1 while a task-block vertical time-drag is live — used only to hide the
  // next-day peek sliver so it doesn't distract mid-drag (the pager's own pan
  // is separately disabled via the `dragActive` React state).
  const dragActiveSV = useSharedValue(0);
  // 1 once a pan's `onEnd` has scheduled a settle, so `onFinalize` knows not
  // to snap back when the settle is already on its way.
  const didSettleSV = useSharedValue(0);
  // Index of the page holding the lifted task block (−1 = none). When set,
  // the carried page is pinned to its touch-down position so the block inside
  // stays under the finger if the strip snaps during the drag.
  const carrierIndexSV = useSharedValue(-1);
  // The carried page's `index * width + progress` at drag start — held
  // constant for the drag via `carrierFix` in the page style.
  const carrierOriginSV = useSharedValue(0);

  const hasLaidOutRef = useRef(false);
  // True while a task-drag gesture is live. Unlike `dragActive` (async React
  // state), this ref is written synchronously inside `handleDragChange`, so
  // the false→true transition — the only place the carrier pin is captured —
  // is detected race-free.
  const dragActiveRef = useRef(false);

  // Edge whose day-navigation advance is armed (drives the edge glow); a shared
  // value so arming/disarming never re-renders. Written by `armNavEdge` /
  // `disarmNavEdge` / `endNavHold` below.
  const armedEdgeSV = useSharedValue<DragEdge | null>(null);

  // Each mounted day reports its blocks as mini-day slivers (`DayTimeline`'s
  // `onPeekChange`); the focused page's right-edge peel shows the *next* day's,
  // keyed by that day's `dateKey`. Only ever holds ~4 entries (the 3-day window
  // + its next day), so no pruning needed.
  const [peekByDay, setPeekByDay] = useState<Record<string, PeekBlock[]>>({});
  const handlePeekChange = useCallback((blocks: PeekBlock[], key: string) => {
    setPeekByDay((prev) =>
      prev[key] === blocks ? prev : { ...prev, [key]: blocks },
    );
  }, []);
  const nextDayKey = useMemo(
    () => dateKey(shiftDays(focusedDate, 1)),
    [focusedDate],
  );
  const peekBlocks = peekByDay[nextDayKey] ?? EMPTY_PEEK;

  // ── Day-navigation edge-hold ───────────────────────────────────────────────
  // Set true once a nav drag's edge-hold has advanced the day at least once,
  // so the `focusedDate` effect (and its stale-closure hazard) stays out of the
  // way for the rest of the gesture.
  const navHoldRef = useRef(false);
  const navArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navAdvanceRef = useRef<(dir: 1 | -1) => void>(() => {});
  // The current finger translation of a live nav drag, mirrored to the UI
  // thread so `navAdvance` (JS) can rebase against it.
  const navTranslationXSV = useSharedValue(0);
  // Translation subtracted from the finger delta after each auto-advance, so a
  // still-held finger reads as "centred" again rather than snapping the fresh
  // day straight back to the edge.
  const navRebaseXSV = useSharedValue(0);
  const navEdgeSV = useSharedValue<DragEdge | null>(null);

  useEffect(
    () => () => {
      if (navArmTimerRef.current) clearTimeout(navArmTimerRef.current);
    },
    [],
  );

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
    // The header block moves 1:1 with the finger and the pages match it —
    // `PagerPage` reads `headerStripSV` directly to switch off the day-swipe
    // parallax while the header owns the strip, so nothing here needs to flag
    // it. Just make sure the parallax hold isn't left on.
    draggingSV.value = 0;
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
    // A nav edge-hold owns the window/progress directly (`navAdvance`) — this
    // effect re-entering here would start a competing settle and disable the
    // pan mid-drag.
    if (navHoldRef.current) return;
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
  // A stable entry point so `panGesture` (below) never has to list `handlePanEnd`
  // — which changes identity whenever `days` does — as a dependency. A nav
  // edge-hold rebuilds the window mid-gesture (`navAdvance` → `setDays`), and a
  // fresh `Gesture.Pan()` object handed to the live `GestureDetector` on that
  // frame would drop the in-flight drag (the hazard RNGH warns about).
  const handlePanEndRef = useRef(handlePanEnd);
  handlePanEndRef.current = handlePanEnd;
  const dispatchPanEnd = useCallback((dragPx: number, velocityX: number) => {
    handlePanEndRef.current(dragPx, velocityX);
  }, []);

  // Nav edge-hold fired: commit one day in `dir`, re-centre the window on it,
  // and rebase the finger delta so the still-held finger reads as "centred"
  // again (otherwise the fresh day would snap straight back to the edge). Then
  // re-arm — holding at the edge walks a day every `NAV_HOLD_MS`.
  const navAdvance = useCallback(
    (dir: 1 | -1) => {
      const current = daysRef.current[1] ?? focusedDate;
      const next = shiftDays(current, dir);
      navHoldRef.current = true;
      const win = centeredDays(next);
      daysRef.current = win;
      setDays(win);
      setFocusedIndex(1);
      commitRoles(1);
      onFocusedDateChange(next);
      navRebaseXSV.value = navTranslationXSV.value;
      progress.value = -width;
      navArmTimerRef.current = setTimeout(
        () => navAdvanceRef.current(dir),
        NAV_HOLD_MS,
      );
    },
    [
      focusedDate,
      centeredDays,
      commitRoles,
      onFocusedDateChange,
      navRebaseXSV,
      navTranslationXSV,
      progress,
      width,
    ],
  );
  navAdvanceRef.current = navAdvance;

  const armNavEdge = useCallback(
    (edge: DragEdge) => {
      if (navArmTimerRef.current && armedEdgeSV.value === edge) return;
      if (navArmTimerRef.current) clearTimeout(navArmTimerRef.current);
      armedEdgeSV.value = edge;
      // Finger at the LEFT edge = content dragged left = the next day is sliding
      // in (dir +1); the RIGHT edge reveals the previous day (dir −1). This is
      // the opposite mapping to a *block* cross-day drag, where the edge is the
      // direction the block itself is being carried.
      navArmTimerRef.current = setTimeout(
        () => navAdvanceRef.current(edge === "left" ? 1 : -1),
        NAV_HOLD_MS,
      );
    },
    [armedEdgeSV],
  );

  const disarmNavEdge = useCallback(() => {
    if (navArmTimerRef.current) {
      clearTimeout(navArmTimerRef.current);
      navArmTimerRef.current = null;
    }
    armedEdgeSV.value = null;
  }, [armedEdgeSV]);

  const endNavHold = useCallback(() => {
    if (navArmTimerRef.current) {
      clearTimeout(navArmTimerRef.current);
      navArmTimerRef.current = null;
    }
    navHoldRef.current = false;
    navRebaseXSV.value = 0;
    navEdgeSV.value = null;
    armedEdgeSV.value = null;
  }, [armedEdgeSV, navEdgeSV, navRebaseXSV]);

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
          navRebaseXSV.value = 0;
          navEdgeSV.value = null;
        })
        .onUpdate((e) => {
          navTranslationXSV.value = e.translationX;
          // Clamp the live drag to one page so a hard flick can't pull the
          // second neighbor into view — the settle only ever moves one page.
          // `navRebaseXSV` zeroes the finger delta after each edge-hold auto-
          // advance so the walk stays smooth.
          progress.value =
            -focusedIndex * width +
            clamp(e.translationX - navRebaseXSV.value, -width, width);

          // Edge-hold: while the finger sits within `NAV_EDGE_ZONE` of a screen
          // edge, arm the day auto-advance; disarm the moment it leaves.
          const x = e.absoluteX;
          const edge: DragEdge | null =
            x <= NAV_EDGE_ZONE
              ? "left"
              : x >= width - NAV_EDGE_ZONE
                ? "right"
                : null;
          if (edge !== navEdgeSV.value) {
            navEdgeSV.value = edge;
            if (edge) runOnJS(armNavEdge)(edge);
            else runOnJS(disarmNavEdge)();
          }
        })
        .onEnd((e) => {
          draggingSV.value = 0;
          didSettleSV.value = 1;
          if (navHoldRef.current) {
            // The edge-hold already committed the focus and kept the window
            // centred — just ease `progress` home and clear nav state.
            runOnJS(endNavHold)();
            progress.value = withTiming(-focusedIndex * width, {
              duration: SETTLE_MS,
              easing: Easing.out(Easing.cubic),
            });
            return;
          }
          runOnJS(endNavHold)();
          // `decideSettleTarget` / `SETTLE_VELOCITY` are specified in px per
          // millisecond (see `week-pager-math.ts`), but gesture-handler reports
          // `velocityX` in px per second. Without this conversion every release
          // reads as a flick, so the pager commits a full day on the faintest
          // drag and a gentle drag off a week edge jumps a whole week.
          runOnJS(dispatchPanEnd)(
            e.translationX - navRebaseXSV.value,
            e.velocityX / 1000,
          );
        })
        .onFinalize(() => {
          runOnJS(endNavHold)();
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
    [
      dragActive,
      settling,
      weekMode,
      focusedIndex,
      width,
      dispatchPanEnd,
      armNavEdge,
      disarmNavEdge,
      endNavHold,
      navEdgeSV,
      navRebaseXSV,
      navTranslationXSV,
    ],
  );

  // A task block's vertical time-drag. Locks the pager's horizontal pan and
  // pins the page holding the lifted block (so a stray strip snap can't slide
  // it away). The block stays on its own day — moving it elsewhere is the
  // "Move to…" sheet, not this gesture — so there is no window rebuild on drop.
  const handleDragChange = useCallback(
    (active: boolean) => {
      if (active) {
        // Only the FIRST report starts it — `onDragChange(true)` re-fires on
        // every vertical snap while the block is lifted, and re-pinning the
        // carrier each time would fight the drag.
        if (dragActiveRef.current) return;
        dragActiveRef.current = true;
        setDragActive(true);
        dragActiveSV.value = 1;
        // A task drag takes over the strip — release any settle lock.
        setSettling(false);
        carrierIndexSV.value = focusedIndex;
        carrierOriginSV.value = focusedIndex * width + progress.value;
        return;
      }
      dragActiveRef.current = false;
      setDragActive(false);
      dragActiveSV.value = 0;
      carrierIndexSV.value = -1;
      carrierOriginSV.value = 0;
    },
    [
      focusedIndex,
      progress,
      width,
      carrierIndexSV,
      carrierOriginSV,
      dragActiveSV,
    ],
  );

  // Edge glow — lit only while a day-navigation edge-hold is armed under the
  // finger (`armNavEdge`). No longer a block-drag affordance.
  const leftGlowStyle = useAnimatedStyle(() => ({
    opacity: withTiming(armedEdgeSV.value === "left" ? 1 : 0, {
      duration: 140,
    }),
  }));
  const rightGlowStyle = useAnimatedStyle(() => ({
    opacity: withTiming(armedEdgeSV.value === "right" ? 1 : 0, {
      duration: 140,
    }),
  }));

  // Next-day peek sliver: shown only when the strip is at rest on the focused
  // day (a swipe / week slide / task drag hides it, since the day it previews
  // is mid-change).
  const peekStripStyle = useAnimatedStyle(() => {
    const atRest = Math.abs(progress.value + width) < 2;
    const headerDragging = Math.abs(headerStripSV.value + width) > 1;
    const idle = atRest && !dragActiveSV.value && !headerDragging;
    return { opacity: withTiming(idle ? 1 : 0, { duration: 120 }) };
  });

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
          {days.map((day, index) => {
            const active = dateKey(day) === dateKey(focusedDate);
            return (
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
                headerStripSV={headerStripSV}
                borderColor={borderColor}
              >
                <DayTimeline
                  date={day}
                  showHeader={false}
                  refreshKey={focusTick}
                  isActive={active}
                  syncScroll
                  onSessionPress={onSessionPress}
                  onDragChange={handleDragChange}
                  onRequestReschedule={onRequestReschedule}
                  onRequestScopedUpdate={onRequestScopedUpdate}
                  onPeekChange={handlePeekChange}
                  rightInset={PEEK_STRIP_W}
                  onStateChange={active ? onActiveStateChange : undefined}
                  flashSessionId={active ? flashSessionId : null}
                />
              </PagerPage>
            );
          })}
        </View>
      </GestureDetector>

      {/* Next-day peek sliver on the focused page's right edge (mockup:
          "a sliver of the next day at the right edge signalling the swipe
          gesture"). Sits under the swipe shadow/glow overlay (z-30). */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: PEEK_STRIP_W,
            zIndex: 6,
          },
          peekStripStyle,
        ]}
      >
        <PeekStrip blocks={peekBlocks} />
      </Animated.View>

      <View pointerEvents="none" className="absolute inset-0 z-30">
        {/* Day-navigation edge glows — lit while an edge-hold advance is armed
            during a pager nav drag. */}
        <Animated.View
          style={[
            { position: "absolute", top: 0, bottom: 0, left: 0, width: 56 },
            leftGlowStyle,
          ]}
        >
          <LinearGradient
            colors={[`rgba(${orangeRgb}, 0.34)`, `rgba(${orangeRgb}, 0)`]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          style={[
            { position: "absolute", top: 0, bottom: 0, right: 0, width: 56 },
            rightGlowStyle,
          ]}
        >
          <LinearGradient
            colors={[`rgba(${orangeRgb}, 0)`, `rgba(${orangeRgb}, 0.34)`]}
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
      </View>
    </View>
  );
}

export const WeekPager = forwardRef(WeekPagerImpl);
WeekPager.displayName = "WeekPager";
