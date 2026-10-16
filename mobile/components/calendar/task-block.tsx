import { SpotlightAnchor } from "@/components/checklist/spotlight-anchor";
import { t } from "@/lib/i18n";
import { SessionTypeBadge, sessionTypeIcon } from "./session-type-badge";
import { useLanguage } from "@/hooks/use-language";
import { locale } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import {
  DAILY_HORIZON,
  TIME_GRANULARITY,
  zonedDate,
  zonedWallClockToUtc,
} from "@zenflow/core";
import {
  type BlockLayout,
  SESSION_STRIPE_WIDTH,
  SESSION_TONE_CLASSES,
  SESSION_TONES,
  hexAlpha,
  sessionTone,
} from "@zenflow/core";
import type { DaySegment, SessionAnchor } from "@zenflow/shared";
import { Hand, Lock, SkipForward } from "@/components/Icons";
import { anchorMark } from "@/lib/anchor";
import { toZonedTime } from "date-fns-tz";
import * as Haptics from "expo-haptics";
import { Fragment, memo, useCallback, useEffect, useState } from "react";
import { BlurView } from "expo-blur";
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useOffline } from "@/hooks/use-offline";
import Svg, { Path } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  clamp,
  withSpring,
  withTiming,
  interpolate,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";
import {
  type DayGrid,
  blockTier,
  dragTargetMin,
  minToY,
} from "@/lib/day-grid";
import { LocationChip } from "@/components/calendar/location-chip";
import { CheckOffButton } from "@/components/calendar/check-off-button";
import { useCheckOff } from "@/hooks/use-check-off";
import type { CheckState } from "@/lib/today-summary";
import { useToast } from "@/components/ui/toast";
import { showErrorToast } from "@/lib/task-toasts";
import { showMovedToast } from "@/lib/move-toast";
import {
  chooseOtherTime,
  undoOtherTime,
  useSlotAlternative,
} from "@/lib/slot-alternatives";

/** Blocks shorter than this have no room for the check-off disc. */
const CHECKABLE_MIN_HEIGHT = 40;
/** Right gutter that keeps a block's title clear of the check-off disc. */
const CHECK_GUTTER_PX = 40;

/** Left stripe of a block that is done. */
const DONE_GREEN = "#22C55E";

/** Gap (px) between the DND hatch's diagonal lines. */
const HATCH_SPACING = 7;

/** One SVG path of parallel 45° lines covering a `width`×`height` box. */
function hatchPath(width: number, height: number, spacing: number): string {
  const parts: string[] = [];
  for (let x = -height; x < width; x += spacing) {
    parts.push(`M${x},${height}L${x + height},0`);
  }
  return parts.join("");
}

/** Android pads text for ascenders/descenders on top of `lineHeight`, which
 * pushes a one-line row off-centre in a short block. */
const COMPACT_TEXT_STYLE = {
  includeFontPadding: false,
  textAlignVertical: "center",
} as const;

/** Distance (px) from the top / bottom of the screen a *lifted* block must be
 * dragged into for the timeline to start auto-scrolling under it, so an
 * off-screen drop slot can be reached. Rough bands (a header sits above, a
 * floating tab bar below) — auto-scroll doesn't need pixel precision. */
/** Hold time before a block lifts for dragging (also opens the menu on release). */
const LIFT_HOLD_MS = 350;
const AUTOSCROLL_BAND_TOP = 140;
const AUTOSCROLL_BAND_BOTTOM = 90;

function minutesOfDayLocal(iso: string, tz: string) {
  const d = toZonedTime(new Date(iso), tz);
  return d.getHours() * 60 + d.getMinutes();
}

function fmt(iso: string, tz: string) {
  return toZonedTime(new Date(iso), tz).toLocaleTimeString(locale(), {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "15:00" for the same day as `current`, else "Fri 15:00". */
function otherTimeText(iso: string, current: string, tz: string) {
  const at = toZonedTime(new Date(iso), tz);
  const now = toZonedTime(new Date(current), tz);
  if (at.toDateString() === now.toDateString()) return fmt(iso, tz);
  const day = at.toLocaleDateString(locale(), { weekday: "short" });
  return `${day} ${fmt(iso, tz)}`;
}

/** "9:00 AM" + "10:30 AM" → "9:00–10:30 AM". A mixed AM/PM span, or a 24h
 * locale (no meridiem token), falls back to the spaced full form. */
/** A range for a session that crosses midnight: "11:00 PM – 1:00 AM (tomorrow)", or "11:00 PM (yesterday) – 1:00 AM" on the next day's part. */
function crossRange(start: string, end: string, onNextDay: boolean) {
  return onNextDay
    ? `${start} (${t("yesterday")}) – ${end}`
    : `${start} – ${end} (${t("tomorrow")})`;
}

function joinRange(start: string, end: string) {
  const sm = start.match(/\s([AP]M)$/i);
  const em = end.match(/\s([AP]M)$/i);
  if (sm && em && sm[1].toUpperCase() === em[1].toUpperCase()) {
    return `${start.slice(0, sm.index ?? start.length).trimEnd()}–${end}`;
  }
  return `${start} – ${end}`;
}

interface DragSnap {
  startMin: number;
  /** The dragged session, so a week drag can preview what its drop would shift. */
  taskId?: string;
  /** Whole days the block is dragged sideways (week grid only). */
  dayShift?: number;
}

interface SessionBlockProps {
  segment: DaySegment;
  layout: BlockLayout;
  tz: string;
  /** The day's grid: the only y <-> minute mapping the block uses. */
  grid: DayGrid;
  /** Left edge (px) within the day column — `DayTimeline` cascades
   * overlapping blocks by shifting later columns right. */
  leftOffset: number;
  /** Downward shift (px) that keeps the title of the block beneath visible. */
  topShift?: number;
  blockWidth: number;
  deadline?: string | null;
  /** `Session.late` — placed past its deadline ("accept late deadline"). */
  late?: boolean;
  /** `Session.anchor`: a hand marks a time the user chose, a lock a pinned one. */
  anchor?: SessionAnchor;
  onReschedule?: (taskId: string, startISO: string) => void;
  onDragStateChange?: (snap: DragSnap | null) => void;
  onDragEnd?: (snap: DragSnap | null) => void;
  onPress?: (taskId: string) => void;
  /** Fired when a still-finger long-press lands on this block — the Day/Week
   * "Move to…" trigger. `DayTimeline` looks the full `Session` up by this id
   * and opens the `RescheduleSheet`. Replaces the old edge-drag cross-day
   * mechanic. */
  onRequestReschedule?: (taskId: string) => void;
  /** When set, a still-finger long-press opens this action menu instead of
   * going straight to the reschedule sheet — the menu offers "Move to…" and
   * "Add study session before this". Falls back to `onRequestReschedule` when
   * unset. */
  onLongPressMenu?: (taskId: string) => void;
  /** In the extended-grid timeline, a block whose task runs past midnight is
   * drawn at its TRUE height through the 24:00 line into the dimmed tail —
   * instead of clamping its bottom to midnight (`continues`). */
  drawThroughMidnight?: boolean;
  /** Owned by `DayTimeline`: px the grid has auto-scrolled since this drag
   * began. Added to the finger translation so the block stays glued to the
   * finger while the grid scrolls, and folded into the drop slot so it lands
   * where intended even when that slot started off-screen. */
  autoScrollDeltaSV?: SharedValue<number>;
  /** Written directly (no `runOnJS`) by the actively-dragged block with its
   * live snapped slot (minutes-of-day), left at -1 when idle. Lets
   * `DayTimeline`'s drop-destination line track the drag on the UI thread
   * with zero bridge latency instead of chasing a JS-state update. */
  dragPreviewMinSV?: SharedValue<number>;
  /** Fired (on change) with the vertical auto-scroll direction the lifted
   * block is asking for: −1 (up), 1 (down), 0 (none). */
  onDragVerticalEdge?: (dir: -1 | 0 | 1) => void;
  /** Opaque chrome (px) below `screenHeight` the bottom auto-scroll band must
   * clear — the floating tab-bar pill in Week view sits there. */
  bottomInset?: number;
  /** Play a one-shot "just landed here" entrance (slide in from the right +
   * scale up + a brief primary ring) — set right after this session was created,
   * rescheduled, or the calendar teleported to it. */
  flash?: boolean;
  /** Carry the checklist's "Move a task" / "Hold a task" spotlight anchors (the
   * timeline sets it on one block per page). */
  tip?: boolean;
  /** Bumped by the parent when a drop didn't move the session (save failed,
   * scope sheet cancelled) — releases the drop pin so the card snaps back. */
  settleKey?: number;
  /** Always draw the one-line title, whatever the block's height (week grid). */
  titleOnly?: boolean;
  /** The session's done or skipped state; `undefined` hides the check-off disc. */
  checkState?: CheckState;
  /** Put the check-off disc at the top edge: another block covers the middle. */
  checkAtTop?: boolean;
  /** Draw the check-off disc. Off in the week grid, where a column is too narrow. */
  showCheck?: boolean;
  /** Width (px) of one day column. Set in the week grid, it lets a lifted block
   * also move sideways, one whole day per column. */
  dayWidth?: number;
  /** How many columns the block can move left (negative) and right. */
  minDayShift?: number;
  maxDayShift?: number;
}

function SessionBlockImpl({
  segment,
  layout,
  tz,
  grid,
  leftOffset,
  topShift = 0,
  blockWidth,
  deadline,
  late = false,
  anchor,
  onReschedule,
  onDragStateChange,
  onDragEnd,
  onPress,
  onRequestReschedule,
  onLongPressMenu,
  drawThroughMidnight = false,
  autoScrollDeltaSV,
  dragPreviewMinSV,
  onDragVerticalEdge,
  bottomInset = 0,
  flash = false,
  tip = false,
  settleKey = 0,
  titleOnly = false,
  checkState,
  showCheck = true,
  checkAtTop = false,
  dayWidth = 0,
  minDayShift = 0,
  maxDayShift = 0,
}: SessionBlockProps) {
  useLanguage();
  const checkOff = useCheckOff();
  const { toast } = useToast();
  const alternative = useSlotAlternative(segment.taskId);
  const takeOtherTime = useCallback(() => {
    if (!alternative) return;
    Haptics.selectionAsync().catch(() => undefined);
    const fail = (error: unknown) =>
      showErrorToast(toast, error, t("Couldn't move this session"), "calendar-x");
    chooseOtherTime(segment.taskId)
      .then((picked) => {
        const at = picked?.session.scheduledStartTime;
        if (!at) return;
        const groupId = picked.undoGroupId;
        showMovedToast(toast, {
          to: zonedDate(at, tz),
          withTime: true,
          onUndo: groupId
            ? () => void undoOtherTime(segment.taskId, alternative, groupId).catch(fail)
            : undefined,
        });
      })
      .catch(fail);
  }, [alternative, segment.taskId, toast, tz]);
  // The chip names the time it moves to, with the weekday when it changes day.
  const otherTimeLabel = alternative
    ? otherTimeText(alternative.alternativeSlot, segment.taskStart, tz)
    : "";
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const { isDarkColorScheme } = useColorScheme();
  const startMin = minutesOfDayLocal(segment.start, tz);
  const rawEndMin = minutesOfDayLocal(segment.end, tz);
  // A task spilling past midnight normally clamps its bottom to 24:00
  // (`continues`). With `drawThroughMidnight` it keeps its real height and
  // draws on through the line into the tail region below.
  const drawsThrough = drawThroughMidnight && Boolean(segment.continues);
  const realDurationMin = Math.round(
    (new Date(segment.taskEnd).getTime() -
      new Date(segment.taskStart).getTime()) /
      60000,
  );
  const endMin = drawsThrough
    ? startMin + realDurationMin
    : segment.continues || rawEndMin === 0
      ? DAILY_HORIZON
      : rawEndMin;
  // Block edges come from the grid, so a block crossing a folded night still
  // has its true pixel extent.
  const topPx = minToY(grid, startMin);
  const height = Math.max(minToY(grid, endMin) - topPx, 16);
  const tier = titleOnly ? "title" : blockTier(height);

  // Overlapping blocks render in their normal type colour — no conflict state,
  // no annotation. `layout` still cascades them (see `DayTimeline`).
  const state = segment.state;
  const isSplit = Boolean(segment.continued);
  // Any whole (non-split) block can be dragged/long-pressed into "Move
  // to…" — fixed types (DND/ASSIGNMENT/EXAM/LECTURE) route through the same
  // gesture as TASK now; a series/recurring touch is disambiguated by the
  // scope rule upstream (`resolveMoveScope` in `lib/recurring-scope.ts`),
  // not by locking the gesture out here.
  // Offline there is nothing to write: drag and long-press are off, tap still opens.
  const offline = useOffline();
  const isInteractive = !isSplit && !offline;
  // …but every block is tappable, the carried-over tail of a session that
  // crosses midnight included: it opens the same detail sheet as the head.
  const isTappable = !!onPress;
  // Overdue = the server flagged it late (placed past its deadline) or it now
  // starts after its deadline (e.g. dragged there). Drives the tone only; the
  // block carries no badge (the detail view shows the deadline).
  const overdue =
    (late ||
      (!!deadline &&
        new Date(segment.taskStart).getTime() > new Date(deadline).getTime())) &&
    state !== "dnd";

  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const isDragging = useSharedValue(0);
  // Eased 0→1 mirror of `isDragging`, advanced ONCE per lift/drop by the
  // reaction below. The per-frame move style reads this and `interpolate`s —
  // it never calls `withTiming` itself, so a finger frame is a handful of
  // cheap arithmetic ops instead of restarting six timing animations.
  const liftProgress = useSharedValue(0);
  // 1 → 0 over the entrance animation (see the `flash` effect). 0 at rest.
  const flashProgress = useSharedValue(0);
  const lastSnap = useSharedValue<number | null>(null);
  const lastShift = useSharedValue(0);
  // The block's live vertical offset *snapped to the 15-min grid* while it is
  // being dragged (content-space px, relative to the resting slot). The card
  // renders here — not at the raw finger — so it always sits exactly in the
  // slot it will drop into (WYSIWYG); there is no ±7.5-min jump on release.
  const snapOffsetY = useSharedValue(0);
  // Raw finger translationY of the live drag, so the auto-scroll reaction can
  // re-snap without a fresh touch event.
  const fingerTYSV = useSharedValue(0);
  // 1 once the finger moved after the hold lifted the block (vs. a still hold).
  const movedSV = useSharedValue(0);
  const hasMenu = !!onRequestReschedule || !!onLongPressMenu;
  // Last reported vertical auto-scroll direction (fire `onDragVerticalEdge`
  // only on change).
  const vEdgeSV = useSharedValue<-1 | 0 | 1>(0);
  // Grid auto-scroll offset since drag start — `DayTimeline`'s when wired,
  // else an inert local so the worklet math is uniform.
  const localAutoScroll = useSharedValue(0);
  const autoScroll = autoScrollDeltaSV ?? localAutoScroll;
  // -1 = no drag preview to show. Falls back to a local inert value when the
  // parent doesn't wire one (mirrors `autoScroll`'s pattern above).
  const localDragPreviewMin = useSharedValue(-1);
  const dragPreviewMin = dragPreviewMinSV ?? localDragPreviewMin;

  // The card's vertical slot (minutes of day). Normally it just tracks
  // `startMin` from props. On drop we set this to the target slot on the UI
  // thread in the *same* frame the drag offset is zeroed, so the card is
  // positioned entirely from the new slot with no intermediate frame where a
  // freshly re-rendered `top` and the stale drag offset both apply — that
  // one bad frame is the post-drop "shift". Once the reschedule round-trips
  // and the prop catches up, the effect below drops the pin.
  const pinnedStartMin = useSharedValue<number | null>(null);

  useEffect(() => {
    // Prop-driven slot change (our drop confirmed, or an external
    // reschedule): release the pin and any leftover offset so the card
    // follows the prop again.
    pinnedStartMin.value = null;
    snapOffsetY.value = 0;
    translateY.value = 0;
    translateX.value = 0;
  }, [
    segment.taskStart,
    settleKey,
    pinnedStartMin,
    snapOffsetY,
    translateX,
    translateY,
  ]);

  // Drive the lift chrome once when the drag starts / ends — not per frame.
  const [isDraggingJS, setIsDraggingJS] = useState(false);
  useAnimatedReaction(
    () => isDragging.value,
    (dragging, prev) => {
      if (dragging === prev) return;
      liftProgress.value = withTiming(dragging, { duration: 150 });
      runOnJS(setIsDraggingJS)(dragging === 1);
    },
  );

  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!flash) return;
    setFlashing(true);
    flashProgress.value = 1;
    flashProgress.value = withTiming(0, {
      duration: 640,
      easing: Easing.out(Easing.cubic),
    });
    const t = setTimeout(() => setFlashing(false), 900);
    return () => clearTimeout(t);
  }, [flash, flashProgress]);

  // Per-frame: translation + a scale/rotate read purely off `liftProgress` /
  // `flashProgress` (no `withTiming` in here). The auto-scroll compensation
  // only applies to the block actually being dragged — otherwise every idle
  // block gets shoved by `autoScroll.value` and visibly slides against the
  // grid while the timeline auto-scrolls.
  const moveStyle = useAnimatedStyle(() => {
    // Only a create / reschedule / teleport plays the scale-and-ring "landing"
    // flash (`flashProgress` decays 1 → 0 — a quick scale pop settling back to
    // rest). A plain drag no longer scales or tilts the card: it just tracks
    // the finger (and lifts its shadow, `shadowStyle`).
    const p = 1 - flashProgress.value;
    const pop = interpolate(p, [0, 0.35, 1], [1, 1.05, 1]);
    return {
      transform: [
        {
          // While dragging, the card sits in its grid-snapped slot
          // (`snapOffsetY`, already in content space so no auto-scroll term);
          // otherwise it follows `translateY` (rest / spring-back).
          translateY:
            isDragging.value === 1 ? snapOffsetY.value : translateY.value,
        },
        { translateX: translateX.value + interpolate(p, [0, 1], [10, 0]) },
        { scale: pop },
      ],
    };
  });

  // A brand-coloured ring that ripples outward and fades as the block lands —
  // the "just created / just rescheduled / teleported here" cue. Rendered as a
  // real overlay `View` (NativeWind's `ring-*` is a no-op on native), only
  // mounted while `flashing`.
  const flashRingStyle = useAnimatedStyle(() => {
    const p = 1 - flashProgress.value;
    return {
      opacity: interpolate(p, [0, 0.12, 1], [0, 0.9, 0]),
      transform: [{ scale: interpolate(p, [0, 1], [0.98, 1.16]) }],
    };
  });

  const shadowStyle = useAnimatedStyle(() => {
    const lift = liftProgress.value;
    return {
      shadowColor: "#000",
      shadowOpacity: interpolate(lift, [0, 1], [0, 0.3]),
      shadowRadius: interpolate(lift, [0, 1], [4, 14]),
      shadowOffset: { width: 0, height: interpolate(lift, [0, 1], [1, 10]) },
      elevation: interpolate(lift, [0, 1], [1, 10]),
    };
  });

  // `liftProgress` already eases 0 -> 1 over the same 150ms off `isDragging`
  // (see the reaction above) — reading it avoids starting a new `withTiming`
  // inside the style worklet on every frame, per block, on every mounted page.
  const footprintStyle = useAnimatedStyle(() => ({
    opacity: liftProgress.value,
  }));

  // A session nested inside another block's range stacks on top of it,
  // inset down-and-right (mirrors the web's `scheduled-block-item.tsx`).
  const isNested = Boolean(layout.nested);
  const nestOffset = isNested ? 6 + (layout.nestIndex ?? 0) * 6 : 0;
  const topOffset = Math.max(nestOffset, topShift);
  // Drawn over another block: needs an opaque backing + shadow.
  const cascadeLayer = Math.min(layout.column, 9);
  const isStacked = isNested || cascadeLayer > 0;

  const wrapperStyle = useAnimatedStyle(() => {
    const effectiveStart =
      pinnedStartMin.value != null ? pinnedStartMin.value : startMin;
    return {
      top: minToY(grid, effectiveStart) + topOffset,
      zIndex: isDragging.value ? 40 : isNested ? 30 : 10 + cascadeLayer,
    };
  });

  const reportSnap = useCallback(
    (min: number, dayShift: number) => {
      onDragStateChange?.({ startMin: min, taskId: segment.taskId, dayShift });
    },
    [onDragStateChange, segment.taskId],
  );

  const reportDragEnd = useCallback(() => {
    onDragStateChange?.(null);
  }, [onDragStateChange]);

  const reportDragSnapEnd = useCallback(
    (min: number) => {
      onDragEnd?.({ startMin: min });
    },
    [onDragEnd],
  );

  const handleDragEnd = useCallback(
    // `newStartMin` is the slot the *preview* last showed (`lastSnap`), so the
    // drop lands exactly where the dashed line / snapped card sat — never a
    // grid step off.
    (newStartMin: number, dayShift: number) => {
      if (!isInteractive || !onReschedule) return;
      if (newStartMin === startMin && dayShift === 0) return;

      const newWall = zonedDate(segment.taskStart, tz);
      newWall.setDate(newWall.getDate() + dayShift);
      newWall.setHours(Math.floor(newStartMin / 60), newStartMin % 60, 0, 0);

      const newStart = zonedWallClockToUtc(newWall, tz);

      if (newStart.toISOString() === segment.taskStart) return;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onReschedule(segment.taskId, newStart.toISOString());
    },
    [
      isInteractive,
      onReschedule,
      startMin,
      segment.taskStart,
      segment.taskId,
      tz,
    ],
  );

  const snapHaptic = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
  }, []);

  // Re-snap the block + preview as the grid auto-scrolls under a still finger,
  // so a drop after an edge-hold lands on the slot the preview last showed.
  useAnimatedReaction(
    () => (isDragging.value === 1 ? autoScroll.value : 0),
    (as, prev) => {
      if (prev == null || as === prev || isDragging.value !== 1) return;
      const snapped =
        Math.round(
          (dragTargetMin(grid, startMin, fingerTYSV.value + as) - startMin) /
            TIME_GRANULARITY,
        ) * TIME_GRANULARITY;
      const nsm = clamp(
        startMin + snapped,
        0,
        DAILY_HORIZON - TIME_GRANULARITY,
      );
      snapOffsetY.value = minToY(grid, nsm) - minToY(grid, startMin);
      dragPreviewMin.value = nsm;
      if (lastSnap.value !== nsm) {
        lastSnap.value = nsm;
        runOnJS(reportSnap)(nsm, lastShift.value);
        runOnJS(snapHaptic)();
      }
    },
  );

  // Declared before `panGesture`: its worklets capture these when they are
  // created, and a callback defined further down is captured as `undefined`
  // (Hermes has no temporal dead zone), which crashed on the first long press.
  const liftHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const openMenu = useCallback(() => {
    if (onLongPressMenu) onLongPressMenu(segment.taskId);
    else onRequestReschedule?.(segment.taskId);
  }, [onLongPressMenu, onRequestReschedule, segment.taskId]);

  // The drag is hold-then-drag: a swipe that starts on a block scrolls the
  // day / pages the week right away, and only a finger held still for 350ms
  // lifts the block. Released without moving, the same hold opens the "Move
  // to…" sheet (see `onEnd`). Once active this pan owns the touch, so the
  // pager and scroll view can no longer steal it.
  const panGesture = Gesture.Pan()
    .enabled(isInteractive)
    .activateAfterLongPress(LIFT_HOLD_MS)
    .onStart(() => {
      movedSV.value = 0;
      runOnJS(liftHaptic)();
    })
    .onUpdate((e) => {
      const absX = Math.abs(e.translationX);
      const absY = Math.abs(e.translationY);

      if (absX > 6 || absY > 6) movedSV.value = 1;
      translateY.value = e.translationY;
      fingerTYSV.value = e.translationY;
      // Grid scroll that happened under the finger counts toward the move.
      const effTY = e.translationY + autoScroll.value;

      // In the week grid a lifted block follows the finger on both axes.
      const shifting = dayWidth > 0;
      if (shifting ? absX > 6 || absY > 6 || isDragging.value === 1 : absY > absX) {
        isDragging.value = 1;
        const dayShift = shifting
          ? clamp(Math.round(e.translationX / dayWidth), minDayShift, maxDayShift)
          : 0;
        translateX.value = dayShift * dayWidth;

        const deltaMinutes = dragTargetMin(grid, startMin, effTY) - startMin;
        const snappedMinutes =
          Math.round(deltaMinutes / TIME_GRANULARITY) * TIME_GRANULARITY;
        const newStartMin = clamp(
          startMin + snappedMinutes,
          0,
          DAILY_HORIZON - TIME_GRANULARITY,
        );

        // Move the card itself to the snapped slot (content-space px) — it
        // now shows exactly where it will land.
        snapOffsetY.value = minToY(grid, newStartMin) - minToY(grid, startMin);
        dragPreviewMin.value = newStartMin;

        if (lastSnap.value !== newStartMin || lastShift.value !== dayShift) {
          lastSnap.value = newStartMin;
          lastShift.value = dayShift;
          runOnJS(reportSnap)(newStartMin, dayShift);
          runOnJS(snapHaptic)();
        }

        // Ask the timeline to auto-scroll when the finger is near a screen
        // edge, so a drop slot that is currently off-screen can be reached.
        if (onDragVerticalEdge) {
          const y = e.absoluteY;
          const dir: -1 | 0 | 1 =
            y <= AUTOSCROLL_BAND_TOP
              ? -1
              : y >= screenHeight - bottomInset - AUTOSCROLL_BAND_BOTTOM
                ? 1
                : 0;
          if (dir !== vEdgeSV.value) {
            vEdgeSV.value = dir;
            runOnJS(onDragVerticalEdge)(dir);
          }
        }
      }
      // Outside the week grid the lifted block only moves on the vertical
      // (time) axis: another day is the "Move to…" sheet's job (long-press).
    })
    .onEnd((e) => {
      const absX = Math.abs(e.translationX);
      const absY = Math.abs(e.translationY);
      const effTY = e.translationY + autoScroll.value;

      if (isDragging.value === 1 || (dayWidth === 0 && absY > absX)) {
        // Land on the slot the preview last showed (`lastSnap`), so drop ==
        // preview exactly. Fall back to a fresh compute if no snap was ever
        // reported (a drag that never crossed a grid line).
        const fallback = clamp(
          startMin +
            Math.round(
              (dragTargetMin(grid, startMin, effTY) - startMin) /
                TIME_GRANULARITY,
            ) *
              TIME_GRANULARITY,
          0,
          DAILY_HORIZON - TIME_GRANULARITY,
        );
        const newStartMin = lastSnap.value ?? fallback;
        const dayShift = dayWidth > 0 ? lastShift.value : 0;
        const movedVertically = newStartMin !== startMin || dayShift !== 0;

        // A lifted block is always re-anchored; `handleDragEnd` re-checks on
        // the JS thread whether the drop is a real move and no-ops otherwise.
        if (movedVertically || isDragging.value === 1) {
          // Re-anchor the card to the target slot and drop the drag offset in
          // the same UI-thread frame — no spring-back, no overshoot — then
          // fire the reschedule. `pinnedStartMin` holds this slot until the
          // prop catches up.
          pinnedStartMin.value = newStartMin;
          snapOffsetY.value = 0;
          translateY.value = 0;
          translateX.value = dayShift * dayWidth;
          runOnJS(handleDragEnd)(newStartMin, dayShift);
          runOnJS(reportDragSnapEnd)(newStartMin);
        } else {
          // No real move — hand control back to `translateY` and spring home.
          isDragging.value = 0;
          snapOffsetY.value = 0;
          translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
          translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
        }
      } else {
        isDragging.value = 0;
        snapOffsetY.value = 0;
        translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
        translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
        // Held and released in place: open the "Move to…" sheet.
        if (movedSV.value === 0 && hasMenu) runOnJS(openMenu)();
      }
    })
    .onFinalize(() => {
      isDragging.value = 0;
      snapOffsetY.value = 0;
      lastSnap.value = null;
      lastShift.value = 0;
      fingerTYSV.value = 0;
      dragPreviewMin.value = -1;
      if (onDragVerticalEdge && vEdgeSV.value !== 0) {
        vEdgeSV.value = 0;
        runOnJS(onDragVerticalEdge)(0);
      }
      runOnJS(reportDragEnd)();
    });

  const triggerPress = useCallback(() => {
    onPress?.(segment.taskId);
  }, [onPress, segment.taskId]);

  // Shorter than the hold, so lifting a held block never also counts as a tap.
  const tapGesture = Gesture.Tap()
    .enabled(isTappable)
    .maxDuration(LIFT_HOLD_MS - 50)
    .onEnd(() => {
      runOnJS(triggerPress)();
    });

  // The carried-over tail can't be dragged, but holding it still opens the
  // same actions sheet as the head (it acts on the whole session).
  const menuGesture = Gesture.LongPress()
    .enabled(isSplit && !offline)
    .minDuration(LIFT_HOLD_MS)
    .onStart(() => {
      runOnJS(liftHaptic)();
      runOnJS(openMenu)();
    });

  const composedGesture = Gesture.Simultaneous(panGesture, tapGesture, menuGesture);

  // The check-off disc sits outside the drag gesture so a tap on it never
  // opens the session; it fades while the block is lifted for a move.
  const checkable =
    !!checkState &&
    showCheck &&
    segment.type === "TASK" &&
    isInteractive &&
    !drawsThrough &&
    height >= CHECKABLE_MIN_HEIGHT;
  const checkFadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - liftProgress.value,
  }));

  // Glass edge: each state tints its own rim (below); the only extra ring is
  // the "landing" flash on create / reschedule / teleport.
  // Always a ring class (transparent at rest): a className that gains `ring-*`
  // between renders makes NativeWind "upgrade" the component mid-life, which
  // crashed the block right after a save (the flash).
  const flashRing = flashing
    ? "ring-2 ring-primary"
    : "ring-1 ring-transparent";
  // DND diagonal hatch (`.hatch-dnd` in mockups/day-view.html). Explicit line
  // segments: an SVG `<Pattern>` clipped its 1px stroke at the tile edge.
  const dndHatchPath =
    state === "dnd" ? hatchPath(screenWidth, height, HATCH_SPACING) : "";
  const dndHatchStroke = SESSION_TONES.dnd.ink[isDarkColorScheme ? "dark" : "light"];
  // Translucent tone fill (12% light, 22% dark) so overlapping blocks blend.
  // One even 1px rim per tone; the 3px stripe is a separate rounded bar inset
  // inside the block, like Apple Calendar.
  const tone = sessionTone(state, overdue);
  // The session kind owns the colour (see `SESSION_TONES`), not its course.
  const stateClasses = `${flashRing} ${SESSION_TONE_CLASSES[tone].tint}`;
  // Solid single-colour rim, drawn as its own overlay ABOVE the blur: a border on
  // the blurred container itself came out jagged (the blur mask isn't anti-aliased).
  const isDone = checkState === "done";
  const edgeColor = hexAlpha(
    SESSION_TONES[tone].base,
    isDarkColorScheme ? 0.45 : 0.55,
  );
  // A done block shows a green left stripe and fades as a whole.
  const isSkipped = checkState === "skipped";
  const doneBlockStyle = isDone
    ? ({ opacity: 0.62 } as const)
    : isSkipped
      ? ({ opacity: 0.45 } as const)
      : null;
  const topRadius = segment.continued ? 0 : 14;
  const bottomRadius = segment.continues && !drawsThrough ? 0 : 14;

  const accentColor = isDone
    ? DONE_GREEN
    : isSkipped
      ? SESSION_TONES.dnd.base
      : SESSION_TONES[tone].base;
  // Meta/time text: the tone's AA ink, or the course ink.
  const timeClass = SESSION_TONE_CLASSES[tone].text;
  // The type icon wears the course ink on a course block, so the type stays
  // visible without a badge.
  // A hand on a time the user chose, a lock on a pinned one; none otherwise.
  const mark = anchorMark(anchor);
  const TypeIcon = sessionTypeIcon(segment.type);
  const typeInk = SESSION_TONES[tone].ink[isDarkColorScheme ? "dark" : "light"];
  const MarkIcon = mark === "hand" ? Hand : mark === "lock" ? Lock : null;

  const horizontal = {
    left: leftOffset + nestOffset,
    width: blockWidth - nestOffset,
  };

  return (
    <Animated.View
      className="absolute"
      style={[
        wrapperStyle,
        { ...horizontal, height },
        // No shadow and no opaque backing: on a translucent block a shadow shows
        // through as gray, and a stacked block must let the one beneath show.
        isStacked && { borderRadius: 14 },
      ]}
    >
      {isDraggingJS && (
        <Animated.View
          pointerEvents="none"
          style={footprintStyle}
          className="absolute inset-0 rounded-[14px] border-[1.5px] border-dashed border-muted-foreground/40 bg-muted/40"
        />
      )}
      {tip && !segment.continued ? (
        <>
          <SpotlightAnchor step="move-task" />
          <SpotlightAnchor step="block-actions" />
        </>
      ) : null}
      {flashing && (
        <Animated.View
          pointerEvents="none"
          style={flashRingStyle}
          className="absolute -inset-[3px] rounded-[17px] border-2 border-primary"
        />
      )}
      <GestureDetector gesture={composedGesture}>
        <Animated.View
          testID={`task-block.${segment.taskId}`}
          style={[
            moveStyle,
            { height },
            // Title at the top of a tall block; centred only when it is one line high.
            tier !== "full"
              ? { paddingTop: Math.max(0, Math.min(5, (height - 14) / 2)) }
              : null,
            checkable ? { paddingRight: CHECK_GUTTER_PX } : null,
            doneBlockStyle,
          ]}
          className={cn(
            "flex overflow-hidden rounded-[14px]",
            tier !== "full"
              ? "flex-row items-start gap-1 pl-3.5 pr-2"
              : "flex-col gap-0.5 pl-4 pr-2.5 py-1.5",
            segment.continues && !drawsThrough && "rounded-b-none",
            segment.continued && "rounded-t-none [border-top-style:dashed]",
            isInteractive && "cursor-grab",
            stateClasses,
          )}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${segment.title}, ${fmt(
            segment.taskStart,
            tz,
          )} ${t("to")} ${fmt(segment.taskEnd, tz)}`}
        >
          {/* Real glass on iOS: blur whatever is behind, including the block
              beneath an overlapping one, so colours blend; the tint comes from
              the translucent fill above. */}
          {Platform.OS === "ios" ? (
            <BlurView
              pointerEvents="none"
              intensity={isDarkColorScheme ? 35 : 28}
              tint={isDarkColorScheme ? "dark" : "light"}
              // UIVisualEffectView ignores the parent's rounded clip: round it
              // itself or its square corners show past the rim.
              style={[
                StyleSheet.absoluteFill,
                {
                  overflow: "hidden",
                  borderTopLeftRadius: topRadius,
                  borderTopRightRadius: topRadius,
                  borderBottomLeftRadius: bottomRadius,
                  borderBottomRightRadius: bottomRadius,
                },
              ]}
            />
          ) : null}
          {/* Accent bar: inset and fully rounded. Must sit ABOVE the blur layer,
              or the blur smears it into a wide glow. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 6,
              bottom: 6,
              left: 6,
              width: SESSION_STRIPE_WIDTH,
              borderRadius: SESSION_STRIPE_WIDTH / 2,
              backgroundColor: accentColor,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderWidth: 1,
              // The edge cut at midnight is drawn dashed below.
              borderTopWidth: segment.continued ? 0 : 1,
              borderBottomWidth: segment.continues && !drawsThrough ? 0 : 1,
              borderColor: edgeColor,
              borderTopLeftRadius: topRadius,
              borderTopRightRadius: topRadius,
              borderBottomLeftRadius: bottomRadius,
              borderBottomRightRadius: bottomRadius,
            }}
          />
          {segment.continued || (segment.continues && !drawsThrough) ? (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                [segment.continued ? "top" : "bottom"]: 0,
                height: 0,
                borderTopWidth: 1.5,
                borderStyle: "dashed",
                borderColor: edgeColor,
              }}
            />
          ) : null}
          {state === "dnd" && (
            <View pointerEvents="none" className="absolute inset-0">
              <Svg width="100%" height="100%">
                <Path
                  d={dndHatchPath}
                  stroke={dndHatchStroke}
                  strokeWidth={1}
                  strokeOpacity={isDarkColorScheme ? 0.26 : 0.22}
                />
              </Svg>
            </View>
          )}
          {tier !== "full" ? (
            // Short blocks: one row. Under 24px the title alone; under 44px the
            // title and start time, led by the type icon.
            <View
              key="compact"
              className="w-full min-w-0 flex-row items-center gap-1.5"
            >
              {/* Explicit px line heights: `leading-none` clipped the tops of
                  the glyphs on Android. */}
              <TypeIcon size={11} color={typeInk} />
              <Text
                className={cn(
                  "min-w-0 flex-1 text-[11px] font-semibold leading-[14px]",
                  isDone && "line-through",
                )}
                style={COMPACT_TEXT_STYLE}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {segment.title}
              </Text>
              {MarkIcon && (
                <View testID={`anchor-mark.${segment.taskId}`} className="shrink-0">
                  <MarkIcon size={11} className={timeClass} />
                </View>
              )}
              {isSkipped && (
                <View testID={`skip-mark.${segment.taskId}`} className="shrink-0">
                  <SkipForward size={11} className="text-muted-foreground" />
                </View>
              )}
              {tier === "time" && (
                <Text
                  className={cn("shrink-0 text-[11px] font-medium leading-[14px]", timeClass)}
                  style={COMPACT_TEXT_STYLE}
                >
                  {segment.continued
                    ? fmt(segment.taskEnd, tz)
                    : fmt(segment.taskStart, tz)}
                </Text>
              )}
            </View>
          ) : (
            <Fragment key="full">
              <View className="w-full min-w-0 flex-row items-center gap-1.5">
                <SessionTypeBadge type={segment.type} size="md" className="shrink-0" />
                <Text
                  className={cn(
                    "min-w-0 shrink text-[12px] font-semibold leading-4",
                    isDone && "line-through",
                  )}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {segment.title}
                </Text>
                {MarkIcon && (
                  <View testID={`anchor-mark.${segment.taskId}`} className="shrink-0">
                    <MarkIcon size={12} className={timeClass} />
                  </View>
                )}
                {isSkipped && (
                  <View testID={`skip-mark.${segment.taskId}`} className="shrink-0">
                    <SkipForward size={12} className="text-muted-foreground" />
                  </View>
                )}
              </View>
              <Text
                className={cn("text-[12px] font-medium leading-[15px]", timeClass)}
                                numberOfLines={1}
              >
{segment.continued || (segment.continues && !drawsThrough)
                  ? crossRange(
                      fmt(segment.taskStart, tz),
                      fmt(segment.taskEnd, tz),
                      Boolean(segment.continued),
                    )
                  : joinRange(
                      fmt(segment.taskStart, tz),
                      fmt(segment.taskEnd, tz),
                    )}
              </Text>
              {!!segment.location && !segment.continued && (
                <LocationChip location={segment.location} compact />
              )}
            </Fragment>
          )}
        </Animated.View>
      </GestureDetector>
      {alternative && !isSplit && tier === "full" ? (
        <Pressable
          onPress={takeOtherTime}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("Move to {time}", { time: otherTimeLabel })}
          testID={`other-time.${segment.taskId}`}
          className="absolute bottom-1.5 rounded-full border border-primary/40 bg-background/90 px-2.5 py-1"
          style={{ right: checkable ? CHECK_GUTTER_PX : 8 }}
        >
          <Text className="text-[11px] font-semibold leading-[14px] text-primary">
            {t("Or {time}", { time: otherTimeLabel })}
          </Text>
        </Pressable>
      ) : null}
      {checkable && checkState ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            checkFadeStyle,
            {
              position: "absolute",
              right: 0,
              top: checkAtTop || tier === "full" ? 0 : (height - 44) / 2,
            },
          ]}
        >
          <CheckOffButton
            state={checkState}
            title={segment.title}
            onToggle={(next) =>
              checkOff({ id: segment.taskId, title: segment.title }, "complete", next === "done")
            }
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/**
 * Memoised: a sibling block's drag pushes `dragSnap` state on `DayTimeline`,
 * which re-renders the timeline. Without this every `SessionBlock` re-rendered
 * on every 15-min snap of a drag — a re-render storm mid-gesture. Props are
 * primitives, the parent's memoised `segment`/`layout`, stable `useCallback`s
 * and shared values, so a shallow compare is safe.
 */
export const SessionBlock = memo(SessionBlockImpl);
