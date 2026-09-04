import { AlertTriangle, Clock } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { formatDeadlineShort } from "@/lib/session-type";
import { cn } from "@/lib/utils";
import { differenceInCalendarDays } from "date-fns";
import {
  DAILY_HORIZON,
  TIME_GRANULARITY,
  zonedDate,
  zonedWallClockToUtc,
} from "@zenflow/core";
import { withOverlap } from "@zenflow/core";
import type { BlockLayout } from "@zenflow/core";
import type { DaySegment } from "@zenflow/shared";
import { toZonedTime } from "date-fns-tz";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
import { SessionTypeBadge } from "./session-type-badge";

const TAGS_MIN_DURATION = 45;

/** Distance (px) from the top / bottom of the screen a *lifted* block must be
 * dragged into for the timeline to start auto-scrolling under it, so an
 * off-screen drop slot can be reached. Rough bands (a header sits above, a
 * floating tab bar below) — auto-scroll doesn't need pixel precision. */
const AUTOSCROLL_BAND_TOP = 140;
const AUTOSCROLL_BAND_BOTTOM = 90;

const TAG_TINTS = [
  "border-orange-400/40 bg-orange-100/15 dark:border-orange-500/40 dark:bg-orange-500/10",
  "border-yellow-400/45 bg-yellow-100/15 dark:border-yellow-500/45 dark:bg-yellow-500/10",
  "border-lime-400/55 bg-lime-100/25 dark:border-lime-500/55 dark:bg-lime-500/15",
];

function tagTint(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_TINTS[h % TAG_TINTS.length];
}

function minutesOfDayLocal(iso: string, tz: string) {
  const d = toZonedTime(new Date(iso), tz);
  return d.getHours() * 60 + d.getMinutes();
}

function fmt(iso: string, tz: string) {
  return toZonedTime(new Date(iso), tz).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtMin(min: number, tz: string, refISO: string) {
  const d = toZonedTime(new Date(refISO), tz);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "9:00 AM" + "10:30 AM" → "9:00–10:30 AM" — drop the repeated meridiem so the
 * range reads tighter. A mixed AM/PM span, or a 24h locale (no meridiem token),
 * falls back to the spaced full form. */
function joinRange(start: string, end: string) {
  const sm = start.match(/\s([AP]M)$/i);
  const em = end.match(/\s([AP]M)$/i);
  if (sm && em && sm[1].toUpperCase() === em[1].toUpperCase()) {
    return `${start.slice(0, sm.index ?? start.length).trimEnd()}–${end}`;
  }
  return `${start} – ${end}`;
}

/** The compact deadline marker sitting after the time range on a scheduled
 * block. Two states: a muted upcoming pill (`Clock` + relative label) and an
 * amber "late" pill (`AlertTriangle`) once the block starts past its deadline —
 * the latter is also the annotation for a confirmed past-deadline drag. */
function DueChip({ late, label }: { late: boolean; label: string }) {
  return (
    <View
      className={cn(
        "flex-row items-center gap-1 rounded px-1 py-0.5",
        late ? "bg-amber-500/15" : "bg-muted",
      )}
    >
      {late ? (
        <AlertTriangle
          size={9}
          className="text-amber-700 dark:text-amber-300"
        />
      ) : (
        <Clock size={12} className="text-muted-foreground" />
      )}
      <Text
        className={cn(
          "text-xs font-medium leading-none",
          late ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
        )}
      >
        Due {label}
      </Text>
    </View>
  );
}

interface DragSnap {
  startMin: number;
}

interface SessionBlockProps {
  segment: DaySegment;
  layout: BlockLayout;
  tz: string;
  totalHeight: number;
  leftOffset: number;
  blockWidth: number;
  deadline?: string | null;
  onReschedule?: (taskId: string, startISO: string) => void;
  onDragStateChange?: (snap: DragSnap | null) => void;
  onDragEnd?: (snap: DragSnap | null) => void;
  onPress?: (taskId: string) => void;
  /** Fired when a still-finger long-press lands on this block — the Day/Week
   * "Move to…" trigger. `DayTimeline` looks the full `Session` up by this id
   * and opens the `RescheduleSheet`. Replaces the old edge-drag cross-day
   * mechanic. */
  onRequestReschedule?: (taskId: string) => void;
  /** In the extended-grid timeline, a block whose task runs past midnight is
   * drawn at its TRUE height through the 24:00 line into the dimmed tail —
   * instead of clamping its bottom to midnight (`continues`). */
  drawThroughMidnight?: boolean;
  /** Owned by `DayTimeline`: px the grid has auto-scrolled since this drag
   * began. Added to the finger translation so the block stays glued to the
   * finger while the grid scrolls, and folded into the drop slot so it lands
   * where intended even when that slot started off-screen. */
  autoScrollDeltaSV?: SharedValue<number>;
  /** Fired (on change) with the vertical auto-scroll direction the lifted
   * block is asking for: −1 (up), 1 (down), 0 (none). */
  onDragVerticalEdge?: (dir: -1 | 0 | 1) => void;
  /** Opaque chrome (px) below `screenHeight` the bottom auto-scroll band must
   * clear — the floating tab-bar pill in Week view sits there. */
  bottomInset?: number;
  /** Play a one-shot "just landed here" entrance (slide in from the right +
   * scale up + a brief amber ring) — set right after this session was created,
   * rescheduled, or the calendar teleported to it. */
  flash?: boolean;
}

function SessionBlockImpl({
  segment,
  layout,
  tz,
  totalHeight,
  leftOffset,
  blockWidth,
  deadline,
  onReschedule,
  onDragStateChange,
  onDragEnd,
  onPress,
  onRequestReschedule,
  drawThroughMidnight = false,
  autoScrollDeltaSV,
  onDragVerticalEdge,
  bottomInset = 0,
  flash = false,
}: SessionBlockProps) {
  const { height: screenHeight } = useWindowDimensions();
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
  const duration = endMin - startMin;
  const isCompact = duration < 30;
  const showTags = duration > TAGS_MIN_DURATION && segment.tags.length > 0;
  // Short blocks show just the type icon; roomy ones get the icon + label.
  const typeBadgeIconOnly = duration <= TAGS_MIN_DURATION;

  const state = withOverlap(segment.state, layout.conflict);
  const isConflict = state === "conflict";
  const isSplit = Boolean(segment.continued);
  // DND and fixed sessions are pinned — only a flexible TASK can be dragged.
  const isInteractive = !isSplit && segment.type === "TASK";
  // …but every block (incl. a recurring lecture/exam/DND occurrence) is
  // tappable, so it can open its edit screen — the surface for "delete just
  // this occurrence".
  const isTappable = !isSplit && !!onPress;
  // Inline "due" chip: only surfaced when the deadline actually matters right
  // now — the block already starts after it ("late"), or it falls within a day
  // of the block. A comfortably-future deadline shows nothing, keeping the
  // meta line to just the time range.
  const dueChip = ((): { late: boolean; label: string } | null => {
    if (!deadline) return null;
    const startMs = new Date(segment.taskStart).getTime();
    if (startMs > new Date(deadline).getTime())
      return { late: true, label: "late" };
    const daysOut = differenceInCalendarDays(
      zonedDate(deadline, tz),
      zonedDate(segment.taskStart, tz),
    );
    if (daysOut > 1) return null;
    return {
      late: false,
      label: formatDeadlineShort(deadline, tz, new Date(segment.taskStart)),
    };
  })();

  const height = Math.max((duration / DAILY_HORIZON) * totalHeight, 16);
  const pxPerMin = totalHeight / DAILY_HORIZON;

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
  // The block's live vertical offset *snapped to the 15-min grid* while it is
  // being dragged (content-space px, relative to the resting slot). The card
  // renders here — not at the raw finger — so it always sits exactly in the
  // slot it will drop into (WYSIWYG); there is no ±7.5-min jump on release.
  const snapOffsetY = useSharedValue(0);
  // Raw finger translationY of the live drag, so the auto-scroll reaction can
  // re-snap without a fresh touch event.
  const fingerTYSV = useSharedValue(0);
  const [liveStartMin, setLiveStartMin] = useState<number | null>(null);
  // Last reported vertical auto-scroll direction (fire `onDragVerticalEdge`
  // only on change).
  const vEdgeSV = useSharedValue<-1 | 0 | 1>(0);
  // Grid auto-scroll offset since drag start — `DayTimeline`'s when wired,
  // else an inert local so the worklet math is uniform.
  const localAutoScroll = useSharedValue(0);
  const autoScroll = autoScrollDeltaSV ?? localAutoScroll;

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
  }, [segment.taskStart, pinnedStartMin, snapOffsetY, translateX, translateY]);

  // Drive the lift chrome once when the drag starts / ends — not per frame.
  useAnimatedReaction(
    () => isDragging.value,
    (dragging, prev) => {
      if (dragging === prev) return;
      liftProgress.value = withTiming(dragging, { duration: 150 });
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
    const lift = liftProgress.value;
    // 0 → 1 over the flash (`flashProgress` decays 1 → 0). A quick scale pop
    // early, settling back to rest — replaces the old shrink-in.
    const p = 1 - flashProgress.value;
    const pop = interpolate(p, [0, 0.35, 1], [1, 1.05, 1]);
    const scale = (1 + lift * 0.02) * pop;
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
        { scale },
        { rotate: `${lift}deg` },
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

  const footprintStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(isDragging.value, [0, 1], [0, 1]), {
      duration: 150,
    }),
  }));

  const wrapperStyle = useAnimatedStyle(() => {
    const effectiveStart =
      pinnedStartMin.value != null ? pinnedStartMin.value : startMin;
    return {
      top: (effectiveStart / DAILY_HORIZON) * totalHeight,
      zIndex: isDragging.value ? 30 : 10,
    };
  });

  const reportSnap = useCallback(
    (min: number) => {
      setLiveStartMin(min);
      onDragStateChange?.({ startMin: min });
    },
    [onDragStateChange],
  );

  const reportDragEnd = useCallback(() => {
    setLiveStartMin(null);
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
    (newStartMin: number) => {
      if (!isInteractive || !onReschedule) return;
      if (newStartMin === startMin) return;

      const newWall = zonedDate(segment.taskStart, tz);
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
        Math.round((fingerTYSV.value + as) / pxPerMin / TIME_GRANULARITY) *
        TIME_GRANULARITY;
      const nsm = clamp(
        startMin + snapped,
        0,
        DAILY_HORIZON - TIME_GRANULARITY,
      );
      snapOffsetY.value = (nsm - startMin) * pxPerMin;
      if (lastSnap.value !== nsm) {
        lastSnap.value = nsm;
        runOnJS(reportSnap)(nsm);
        runOnJS(snapHaptic)();
      }
    },
  );

  // Horizontal activation threshold (10px) must stay BELOW the Week pager's
  // 12px `activeOffsetX` (week-pager.tsx): a touch that starts on a block
  // then activates this pan first, and RNGH's exclusive parent/child
  // arbitration fails the pager the moment we activate — so the day can never
  // steal a block drag. The block owns any gesture that starts on it.
  const panGesture = Gesture.Pan()
    .enabled(isInteractive)
    .activeOffsetX([-10, 10])
    .activeOffsetY([-10, 10])
    .onUpdate((e) => {
      const absX = Math.abs(e.translationX);
      const absY = Math.abs(e.translationY);

      translateY.value = e.translationY;
      fingerTYSV.value = e.translationY;
      // Grid scroll that happened under the finger counts toward the move.
      const effTY = e.translationY + autoScroll.value;

      if (absY > absX) {
        isDragging.value = 1;

        const deltaMinutes = effTY / pxPerMin;
        const snappedMinutes =
          Math.round(deltaMinutes / TIME_GRANULARITY) * TIME_GRANULARITY;
        const newStartMin = clamp(
          startMin + snappedMinutes,
          0,
          DAILY_HORIZON - TIME_GRANULARITY,
        );

        // Move the card itself to the snapped slot (content-space px) — it
        // now shows exactly where it will land.
        snapOffsetY.value = (newStartMin - startMin) * pxPerMin;

        if (lastSnap.value !== newStartMin) {
          lastSnap.value = newStartMin;
          runOnJS(reportSnap)(newStartMin);
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
      // The lifted block only moves on the vertical (time) axis now — moving a
      // session to another day is the "Move to…" sheet's job (long-press),
      // not a sideways drag, so `translateX` is never written mid-drag.
    })
    .onEnd((e) => {
      const absX = Math.abs(e.translationX);
      const absY = Math.abs(e.translationY);
      const effTY = e.translationY + autoScroll.value;

      if (absY > absX || isDragging.value === 1) {
        // Land on the slot the preview last showed (`lastSnap`), so drop ==
        // preview exactly. Fall back to a fresh compute if no snap was ever
        // reported (a drag that never crossed a grid line).
        const fallback = clamp(
          startMin +
            Math.round(effTY / pxPerMin / TIME_GRANULARITY) * TIME_GRANULARITY,
          0,
          DAILY_HORIZON - TIME_GRANULARITY,
        );
        const newStartMin = lastSnap.value ?? fallback;
        const movedVertically = newStartMin !== startMin;

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
          translateX.value = 0;
          runOnJS(handleDragEnd)(newStartMin);
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
      }
    })
    .onFinalize(() => {
      isDragging.value = 0;
      snapOffsetY.value = 0;
      lastSnap.value = null;
      fingerTYSV.value = 0;
      if (onDragVerticalEdge && vEdgeSV.value !== 0) {
        vEdgeSV.value = 0;
        runOnJS(onDragVerticalEdge)(0);
      }
      runOnJS(reportDragEnd)();
    });

  const triggerPress = useCallback(() => {
    onPress?.(segment.taskId);
  }, [onPress, segment.taskId]);

  const triggerReschedule = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onRequestReschedule?.(segment.taskId);
  }, [onRequestReschedule, segment.taskId]);

  const tapGesture = Gesture.Tap()
    .enabled(isTappable)
    .onEnd(() => {
      runOnJS(triggerPress)();
    });

  // A still finger held on the block opens the "Move to…" sheet; any real
  // drag fails the long-press (`maxDistance`) so `panGesture` wins the
  // `Exclusive` race and runs the in-day vertical time-drag as before. `Tap`
  // stays simultaneous with the pair so a quick tap still opens the editor.
  const longPressGesture = Gesture.LongPress()
    .enabled(isInteractive && !!onRequestReschedule)
    .minDuration(350)
    .maxDistance(12)
    .onStart(() => {
      runOnJS(triggerReschedule)();
    });

  const composedGesture = Gesture.Simultaneous(
    Gesture.Exclusive(longPressGesture, panGesture),
    tapGesture,
  );

  const borderChrome = cn(
    "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50",
    flashing ? "ring-2 ring-amber-400" : "ring-1 ring-amber-500/40",
  );
  const stateClasses =
    state === "conflict"
      ? `${borderChrome} border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/10`
      : state === "dnd"
        ? `${borderChrome} border-l-slate-400 [border-left-style:dashed] bg-slate-500/[0.07] dark:bg-slate-400/10`
        : state === "assignment"
          ? `${borderChrome} border-l-teal-500 bg-teal-50/50 dark:bg-teal-950/20`
          : state === "exam"
            ? `${borderChrome} border-l-rose-500 bg-rose-50/50 dark:bg-rose-950/20`
            : state === "lecture"
              ? `${borderChrome} border-l-sky-500 bg-sky-50/50 dark:bg-sky-950/20`
              : `${borderChrome} border-l-primary glass-task`;

  const isMultiColumn = layout.columns > 1;

  return (
    <Animated.View
      className={cn("absolute", !isMultiColumn && "left-1.5 right-1.5")}
      style={[
        wrapperStyle,
        isMultiColumn
          ? { left: leftOffset, width: blockWidth, height }
          : { height },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={footprintStyle}
        className="absolute inset-0 rounded-[10px] border-[1.5px] border-dashed border-muted-foreground/40 bg-muted/40"
      />
      {flashing && (
        <Animated.View
          pointerEvents="none"
          style={flashRingStyle}
          className="absolute -inset-[3px] rounded-[13px] border-2 border-primary"
        />
      )}
      <GestureDetector gesture={composedGesture}>
        <Animated.View
          style={[moveStyle, shadowStyle, { height }]}
          className={cn(
            "flex overflow-hidden rounded-[10px] border border-l-4",
            isCompact
              ? "items-center justify-between gap-1.5 px-2.5"
              : "flex-col gap-0.5 px-2.5 py-1.5",
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
          )} to ${fmt(segment.taskEnd, tz)}`}
        >
          {isCompact ? (
            <>
              <View className="w-full min-w-0 flex-1 flex-row items-center gap-1">
                {segment.continued ? (
                  <Text className="shrink-0 text-[10px] text-muted-foreground">
                    ↳
                  </Text>
                ) : (
                  <SessionTypeBadge type={segment.type} size="sm" iconOnly />
                )}
                <Text
                  className={cn(
                    "min-w-0 flex-1 text-sm font-semibold leading-none",
                    isConflict && "text-amber-700 dark:text-amber-300",
                  )}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {segment.title}
                </Text>
              </View>
              <View className="mt-1 shrink-0 flex-row items-center gap-1">
                <Text
                  className={cn(
                    "text-[9px] text-muted-foreground leading-none",
                    isConflict && "text-amber-700/90 dark:text-amber-300/90",
                  )}
                >
                  {segment.continued
                    ? `ends ${fmt(segment.taskEnd, tz)}`
                    : liveStartMin != null
                      ? fmtMin(liveStartMin, tz, segment.taskStart)
                      : fmt(segment.taskStart, tz)}
                </Text>
                {dueChip && <DueChip {...dueChip} />}
              </View>
            </>
          ) : (
            <>
              {isConflict && (
                <View className="self-start flex-row items-center justify-center gap-1 rounded-md border border-transparent bg-amber-500/15 px-2 py-0.5">
                  <AlertTriangle
                    size={11}
                    className="translate-y-[-0.5px] text-amber-700 dark:text-amber-300"
                  />
                  <Text className="text-[10px] font-semibold leading-[11px] text-amber-700 dark:text-amber-300">
                    Overlap
                  </Text>
                </View>
              )}
              <View className="min-w-0 flex-row items-center gap-1.5">
                {segment.continued ? (
                  <Text className="shrink-0 text-[10px] text-muted-foreground">
                    ↳
                  </Text>
                ) : (
                  <SessionTypeBadge
                    type={segment.type}
                    size="md"
                    iconOnly={typeBadgeIconOnly}
                  />
                )}
                <Text
                  className={cn(
                    "min-w-0 flex-1 text-sm font-semibold leading-none",
                    isConflict && "text-amber-700 dark:text-amber-300",
                  )}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {segment.title}
                </Text>
              </View>
              <View className="mt-1 flex-row flex-wrap items-center gap-1">
                <Text
                  className={cn(
                    "text-[10px] text-muted-foreground leading-none",
                    isConflict && "text-amber-700/90 dark:text-amber-300/90",
                  )}
                >
                  {segment.continued
                    ? `cont. → ${fmt(segment.taskEnd, tz)}`
                    : segment.continues && !drawsThrough
                      ? `${fmt(segment.taskStart, tz)} → next day`
                      : liveStartMin != null
                        ? joinRange(
                            fmtMin(liveStartMin, tz, segment.taskStart),
                            fmtMin(
                              Math.min(liveStartMin + duration, DAILY_HORIZON),
                              tz,
                              segment.taskStart,
                            ),
                          )
                        : joinRange(
                            fmt(segment.taskStart, tz),
                            fmt(segment.taskEnd, tz),
                          )}
                </Text>
                {dueChip && <DueChip {...dueChip} />}
              </View>
              {showTags && (
                <View className="mt-0.5 flex-row flex-wrap gap-1 overflow-hidden">
                  {segment.tags.slice(0, 3).map((t) => (
                    <View
                      key={t}
                      className={cn("rounded border px-1.5 py-0.5", tagTint(t))}
                    >
                      <Text className="text-[9px] font-medium">{t}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </Animated.View>
      </GestureDetector>
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
