import { useCallback, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { AlertTriangle } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { DAILY_HORIZON, TIME_GRANULARITY, zonedWallClockToUtc, zonedDate } from "@zenflow/core";
import { withOverlap } from "@zenflow/core";
import type { BlockLayout } from "@zenflow/core";
import type { DaySegment } from "@zenflow/shared";
import { toZonedTime } from "date-fns-tz";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  clamp,
  withSpring,
  withTiming,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const TAGS_MIN_DURATION = 45;

/** Screen-edge zone (px) that a dragged block must enter to cross to the
 * adjacent day. */
const EDGE = 48;

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

interface DragSnap {
  startMin: number;
}

interface TaskBlockProps {
  segment: DaySegment;
  layout: BlockLayout;
  tz: string;
  totalHeight: number;
  leftOffset: number;
  blockWidth: number;
  deadline?: string | null;
  onReschedule?: (taskId: string, startISO: string) => void;
  onDragStateChange?: (snap: DragSnap | null) => void;
  onPress?: (taskId: string) => void;
  onComplete?: (taskId: string) => void;
  /** Mutable cross-day offset (days) applied to the reschedule wall clock on
   * drop — owned by the Week pager so a block can be dragged onto another day. */
  dayOffsetRef?: { current: number };
  /** Fired while the finger is within `EDGE` px of the screen's left/right
   * edge during a vertical drag, letting the Week pager advance to the
   * adjacent day. */
  onDragEdge?: (edge: "left" | "right") => void;
  /** Fired after a reschedule that landed on a different day than the source. */
  onCrossDayReschedule?: (taskId: string, startISO: string) => void;
}

export function TaskBlock({
  segment,
  layout,
  tz,
  totalHeight,
  leftOffset,
  blockWidth,
  deadline,
  onReschedule,
  onDragStateChange,
  onPress,
  onComplete,
  dayOffsetRef,
  onDragEdge,
  onCrossDayReschedule,
}: TaskBlockProps) {
  const { width: screenWidth } = useWindowDimensions();
  const startMin = minutesOfDayLocal(segment.start, tz);
  const rawEndMin = minutesOfDayLocal(segment.end, tz);
  const endMin = segment.continues || rawEndMin === 0 ? DAILY_HORIZON : rawEndMin;
  const duration = endMin - startMin;
  const isCompact = duration < 30;
  const showTags = duration > TAGS_MIN_DURATION && segment.tags.length > 0;

  const state = withOverlap(segment.state, layout.conflict);
  const isConflict = state === "conflict";
  const isOverdue = state === "overdue";
  const isCompleted = segment.status === "DONE";
  const isSplit = Boolean(segment.continued);
  const isInteractive = !isCompleted && !isSplit;
  const dueSuffix = deadline ? ` · due ${fmt(deadline, tz)}` : "";

  const baseTop = (startMin / DAILY_HORIZON) * totalHeight;
  const height = Math.max((duration / DAILY_HORIZON) * totalHeight, 16);
  const pxPerMin = totalHeight / DAILY_HORIZON;

  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const checkOpacity = useSharedValue(0);
  const isDragging = useSharedValue(0);
  const lastSnap = useSharedValue<number | null>(null);
  const [liveStartMin, setLiveStartMin] = useState<number | null>(null);

  const COMPLETE_THRESHOLD = 80;

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
  }));

  const liftStyle = useAnimatedStyle(() => {
    const d = isDragging.value;
    return {
      transform: [
        { translateY: translateY.value },
        { translateX: translateX.value },
        { scale: withTiming(interpolate(d, [0, 1], [1, 1.02]), { duration: 150 }) },
      ],
      shadowColor: "#000",
      shadowOpacity: withTiming(interpolate(d, [0, 1], [0, 0.3]), { duration: 150 }),
      shadowRadius: withTiming(interpolate(d, [0, 1], [4, 14]), { duration: 150 }),
      shadowOffset: {
        width: 0,
        height: withTiming(interpolate(d, [0, 1], [1, 10]), { duration: 150 }),
      },
      elevation: withTiming(interpolate(d, [0, 1], [1, 10]), { duration: 150 }),
    };
  });

  const footprintStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interpolate(isDragging.value, [0, 1], [0, 1]), {
      duration: 150,
    }),
  }));

  const wrapperStyle = useAnimatedStyle(() => ({
    zIndex: isDragging.value ? 30 : 10,
  }));

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

  const triggerCompleteHaptic = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const triggerComplete = useCallback(() => {
    onComplete?.(segment.taskId);
  }, [onComplete, segment.taskId]);

  const handleDragEnd = useCallback(
    (translationY: number) => {
      if (!isInteractive || !onReschedule) return;

      const deltaMinutes = translationY / pxPerMin;
      const snappedMinutes =
        Math.round(deltaMinutes / TIME_GRANULARITY) * TIME_GRANULARITY;

      if (snappedMinutes === 0) return;

      const newStartMin = Math.max(
        0,
        Math.min(DAILY_HORIZON - TIME_GRANULARITY, startMin + snappedMinutes),
      );

      const wall = zonedDate(segment.taskStart, tz);
      wall.setHours(Math.floor(newStartMin / 60), newStartMin % 60, 0, 0);

      // A cross-day drag (Week pager) shifts the wall clock by whole days so
      // the drop lands on the adjacent day while keeping the time-of-day.
      const dayOffset = dayOffsetRef?.current ?? 0;
      if (dayOffset !== 0) wall.setDate(wall.getDate() + dayOffset);

      const newStart = zonedWallClockToUtc(wall, tz);

      if (newStart.toISOString() === segment.taskStart) return;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onReschedule(segment.taskId, newStart.toISOString());
      if (dayOffset !== 0) {
        onCrossDayReschedule?.(segment.taskId, newStart.toISOString());
      }
    },
    [
      isInteractive,
      onReschedule,
      onCrossDayReschedule,
      dayOffsetRef,
      pxPerMin,
      startMin,
      segment.taskStart,
      segment.taskId,
      tz,
    ],
  );

  const panGesture = Gesture.Pan()
    .enabled(isInteractive)
    .activeOffsetX([-20, 20])
    .activeOffsetY([-10, 10])
    .onUpdate((e) => {
      const absX = Math.abs(e.translationX);
      const absY = Math.abs(e.translationY);

      if (absX > absY && e.translationX > 0) {
        translateX.value = e.translationX;
        checkOpacity.value = interpolate(
          e.translationX,
          [0, COMPLETE_THRESHOLD],
          [0, 1],
          { extrapolateRight: "clamp" },
        );
      } else {
        translateY.value = e.translationY;

        if (absY > absX) {
          isDragging.value = 1;

          const deltaMinutes = e.translationY / pxPerMin;
          const snappedMinutes =
            Math.round(deltaMinutes / TIME_GRANULARITY) * TIME_GRANULARITY;
          const newStartMin = clamp(
            startMin + snappedMinutes,
            0,
            DAILY_HORIZON - TIME_GRANULARITY,
          );

          if (lastSnap.value !== newStartMin) {
            lastSnap.value = newStartMin;
            runOnJS(reportSnap)(newStartMin);
          }

          // Cross-day affordance: while the finger is near the screen's
          // left/right edge, nudge the Week pager toward the adjacent day.
          if (onDragEdge) {
            const x = e.absoluteX;
            if (x <= EDGE) runOnJS(onDragEdge)("left");
            else if (x >= screenWidth - EDGE) runOnJS(onDragEdge)("right");
          }
        }
      }
    })
    .onEnd((e) => {
      const absX = Math.abs(e.translationX);
      const absY = Math.abs(e.translationY);

      if (absX > absY && e.translationX > COMPLETE_THRESHOLD) {
        translateX.value = withTiming(blockWidth, { duration: 200 });
        checkOpacity.value = withTiming(0, { duration: 200 });
        runOnJS(triggerCompleteHaptic)();
        runOnJS(triggerComplete)();
      } else if (absY > absX) {
        runOnJS(handleDragEnd)(e.translationY);
      }

      translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
      checkOpacity.value = withTiming(0, { duration: 150 });
    })
    .onFinalize(() => {
      isDragging.value = 0;
      lastSnap.value = null;
      runOnJS(reportDragEnd)();
    });

  const triggerPress = useCallback(() => {
    onPress?.(segment.taskId);
  }, [onPress, segment.taskId]);

  const tapGesture = Gesture.Tap()
    .enabled(isInteractive && !!onPress)
    .onEnd(() => {
      runOnJS(triggerPress)();
    });

  const composedGesture = Gesture.Simultaneous(panGesture, tapGesture);

  const stateClasses =
    state === "overdue"
      ? "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50 border-l-rose-500 bg-rose-50/40 ring-1 ring-amber-500/40 dark:bg-rose-950/10"
      : state === "conflict"
        ? "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50 border-l-amber-500 bg-amber-50/40 ring-1 ring-amber-500/40 dark:bg-amber-950/10"
        : state === "completed"
          ? "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50 border-l-success/60 ring-1 ring-amber-500/40 bg-muted/60"
          : "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50 border-l-primary ring-1 ring-amber-500/40 glass-task";

  const isMultiColumn = layout.columns > 1;

  return (
    <Animated.View
      className={cn("absolute", !isMultiColumn && "left-1.5 right-1.5")}
      style={[
        wrapperStyle,
        isMultiColumn
          ? { top: baseTop, left: leftOffset, width: blockWidth, height }
          : { top: baseTop, height },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={footprintStyle}
        className="absolute inset-0 rounded-[10px] border-[1.5px] border-dashed border-muted-foreground/40 bg-muted/40"
      />
      <GestureDetector gesture={composedGesture}>
        <Animated.View
          style={[liftStyle, { height }]}
          className={cn(
            "flex overflow-hidden rounded-[10px] border border-l-4",
            isCompact ? "items-center justify-between gap-1.5 px-2.5" : "flex-col gap-0.5 px-2.5 py-1.5",
            segment.continues && "rounded-b-none",
            segment.continued && "rounded-t-none [border-top-style:dashed]",
            isInteractive && "cursor-grab",
            stateClasses,
          )}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${segment.title}, ${fmt(segment.taskStart, tz)} to ${fmt(segment.taskEnd, tz)}`}
        >
          <Animated.View
            pointerEvents="none"
            style={checkStyle}
            className="absolute right-2 top-0 bottom-0 z-10 items-center justify-center"
          >
            <Text className="text-lg text-emerald-500">✓</Text>
          </Animated.View>
          {isCompact ? (
            <>
              <View className="min-w-0 flex-1 flex-row items-center gap-1">
                {segment.continued && (
                  <Text className="text-[10px] text-muted-foreground">↳</Text>
                )}
                <Text
                  className={cn(
                    "flex-1 truncate text-[10px] font-semibold leading-none",
                    isCompleted && "line-through",
                    isConflict && "text-amber-700 dark:text-amber-300",
                    isOverdue && "text-rose-950 dark:text-rose-100",
                  )}
                >
                  {segment.title}
                </Text>
              </View>
              <Text
                className={cn(
                  "shrink-0 font-mono text-[9px] text-muted-foreground leading-none",
                  isConflict && "text-amber-700/90 dark:text-amber-300/90",
                )}
              >
                {segment.continued
                  ? `ends ${fmt(segment.taskEnd, tz)}`
                  : liveStartMin != null
                    ? fmtMin(liveStartMin, tz, segment.taskStart)
                    : fmt(segment.taskStart, tz)}
                {dueSuffix}
              </Text>
            </>
          ) : (
            <>
              {isConflict && (
                <View className="self-start flex-row items-center justify-center gap-1 rounded-md border border-transparent bg-amber-500/15 px-2 py-0.5">
                  <AlertTriangle size={11} className="translate-y-[-0.5px] text-amber-700 dark:text-amber-300" />
                  <Text className="text-[10px] font-semibold leading-[11px] text-amber-700 dark:text-amber-300">
                    Overlap
                  </Text>
                </View>
              )}
              <View className="flex-row items-center gap-1">
                {segment.continued && (
                  <Text className="text-[10px] text-muted-foreground">↳</Text>
                )}
                <Text
                  className={cn(
                    "flex-1 truncate text-xs font-semibold leading-none",
                    isCompleted && "line-through",
                    isConflict && "text-amber-700 dark:text-amber-300",
                    isOverdue && "text-rose-950 dark:text-rose-100",
                  )}
                >
                  {segment.title}
                </Text>
              </View>
              <Text
                className={cn(
                  "font-mono text-[10px] text-muted-foreground leading-none",
                  isConflict && "text-amber-700/90 dark:text-amber-300/90",
                  isOverdue && "text-rose-700/80 dark:text-rose-300/70",
                )}
              >
                {segment.continued
                  ? `cont. → ${fmt(segment.taskEnd, tz)}`
                  : segment.continues
                    ? `${fmt(segment.taskStart, tz)} → next day`
                    : liveStartMin != null
                      ? `${fmtMin(liveStartMin, tz, segment.taskStart)} – ${fmtMin(
                          Math.min(liveStartMin + duration, DAILY_HORIZON),
                          tz,
                          segment.taskStart,
                        )}`
                      : `${fmt(segment.taskStart, tz)} – ${fmt(segment.taskEnd, tz)}`}
                {dueSuffix}
              </Text>
              {showTags && (
                <View className="mt-0.5 flex-row flex-wrap gap-1 overflow-hidden">
                  {segment.tags.slice(0, 3).map((t) => (
                    <View
                      key={t}
                      className={cn(
                        "rounded border px-1.5 py-0.5",
                        tagTint(t),
                      )}
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
