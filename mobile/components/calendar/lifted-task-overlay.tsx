import { View, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { AlertTriangle } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { debugLog } from "@/lib/debug-log";
import { DAILY_HORIZON, TIME_GRANULARITY, zonedWallClockToUtc, zonedDate } from "@zenflow/core";
import { withOverlap } from "@zenflow/core";
import type { BlockLayout } from "@zenflow/core";
import type { DaySegment } from "@zenflow/shared";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  clamp,
} from "react-native-reanimated";

const EDGE_ZONE = 150;
const COMPLETE_THRESHOLD = 80;

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
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function fmt(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtMin(min: number, tz: string, refISO: string) {
  const d = new Date(refISO);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface LiftedTaskOverlayProps {
  segment: DaySegment;
  layout: BlockLayout;
  tz: string;
  totalHeight: number;
  startMin: number;
  edge: "left" | "right";
  /** Screen X where the drag entered the edge zone (transfer point) */
  initialX: number;
  /** Screen Y where the drag entered the edge zone */
  initialY: number;
  /** Pager page width (for target day calculation) */
  pageWidth: number;
  /** Current strip progress (for target day calculation) */
  progress: Animated.SharedValue<number>;
  /** Called when dropped on a target day */
  onDrop: (taskId: string, startISO: string) => void;
  /** Called when dragged back from edge (cancel cross-day) */
  onCancel: () => void;
  /** Called when edge zone changes (for glow) */
  onEdgeChange?: (edge: "left" | "right" | null) => void;
}

export function LiftedTaskOverlay({
  segment,
  layout,
  tz,
  totalHeight,
  startMin,
  edge,
  initialX,
  initialY,
  pageWidth,
  progress,
  onDrop,
  onCancel,
  onEdgeChange,
}: LiftedTaskOverlayProps) {
  const { width: screenWidth } = useWindowDimensions();

  const rawEndMin = minutesOfDayLocal(segment.end, tz);
  const endMin = segment.continues || rawEndMin === 0 ? DAILY_HORIZON : rawEndMin;
  const duration = endMin - startMin;
  const isCompact = duration < 45;
  const showTags = duration > 45 && segment.tags.length > 0;

  const state = withOverlap(segment.state, layout.conflict);
  const isConflict = state === "conflict";
  const isOverdue = state === "overdue";
  const isCompleted = segment.status === "DONE";

  const baseTop = (startMin / DAILY_HORIZON) * totalHeight;
  const height = Math.max((duration / DAILY_HORIZON) * totalHeight, 16);
  const pxPerMin = totalHeight / DAILY_HORIZON;

  const translateX = useSharedValue(initialX);
  const translateY = useSharedValue(initialY);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const lastTargetDay = useSharedValue<"left" | "right" | null>(null);

  // Gesture for cross-day drag
  const panGesture = Gesture.Pan()
    .onBegin(() => {
      scale.value = withTiming(1.05, { duration: 100 });
      opacity.value = withTiming(0.95, { duration: 100 });
    })
    .onUpdate((e) => {
      translateX.value = initialX + e.translationX;
      translateY.value = initialY + e.translationY;

      // Detect which day we're over based on screen X
      const stripCenterX = screenWidth / 2 + progress.value;
      const targetEdge: "left" | "right" | null =
        translateX.value < stripCenterX - pageWidth / 2
          ? "left"
          : translateX.value > stripCenterX + pageWidth / 2
          ? "right"
          : null;

      if (targetEdge !== lastTargetDay.value) {
        lastTargetDay.value = targetEdge;
        onEdgeChange?.(targetEdge);
      }
    })
    .onEnd((e) => {
      const targetEdge = lastTargetDay.value;
      const absX = Math.abs(e.translationX);
      const absY = Math.abs(e.translationY);

      // If dropped on a target day (past center of adjacent page)
      if (targetEdge && (absX > pageWidth / 2 || absY < absX)) {
        const dir = targetEdge === "right" ? 1 : -1;
        const newStartMin = clamp(startMin, 0, DAILY_HORIZON - TIME_GRANULARITY);

        const wall = zonedDate(segment.taskStart, tz);
        wall.setHours(Math.floor(newStartMin / 60), newStartMin % 60, 0, 0);
        wall.setDate(wall.getDate() + dir);

        const newStart = zonedWallClockToUtc(wall, tz);

        runOnJS(debugLog)("overlay.drop", {
          task: segment.taskId,
          targetEdge,
          newStart: newStart.toISOString(),
        });

        runOnJS(onDrop)(segment.taskId, newStart.toISOString());
      } else {
        // Dragged back to center — cancel
        runOnJS(onCancel)();
      }

      // Animate back
      scale.value = withSpring(1, { damping: 20, stiffness: 300 });
      opacity.value = withTiming(1, { duration: 150 });
      translateX.value = withSpring(initialX, { damping: 20, stiffness: 300 });
      translateY.value = withSpring(initialY, { damping: 20, stiffness: 300 });
    })
    .onFinalize(() => {
      lastTargetDay.value = null;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
    zIndex: 100,
  }));

  const stateClasses =
    state === "overdue"
      ? "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50 border-l-rose-500 bg-rose-50/40 ring-1 ring-amber-500/40 dark:bg-rose-950/10"
      : state === "conflict"
      ? "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50 border-l-amber-500 bg-amber-50/40 ring-1 ring-amber-500/40 dark:bg-amber-950/10"
      : state === "completed"
      ? "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50 border-l-success/60 ring-1 ring-amber-500/40 bg-muted/60"
      : "border-t-black border-r-black border-b-black dark:border-t-white/50 dark:border-r-white/50 dark:border-b-white/50 border-l-primary ring-1 ring-amber-500/40 glass-task";

  const isMultiColumn = layout.columns > 1;
  const blockWidthPx = isMultiColumn ? 0 : 0; // Not used in overlay

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            top: 0,
            width: isMultiColumn ? (segment as any).blockWidth ?? 100 : "auto",
            maxWidth: screenWidth - 40,
          },
          animatedStyle,
        ]}
        pointerEvents="none"
      >
        <View
          className={cn(
            "flex overflow-hidden rounded-[10px] border border-l-4",
            isCompact ? "items-center justify-between gap-1.5 px-2.5" : "flex-col gap-0.5 px-2.5 py-1.5",
            segment.continues && "rounded-b-none",
            segment.continued && "rounded-t-none [border-top-style:dashed]",
            stateClasses,
          )}
        >
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
                {fmt(segment.taskStart, tz)}
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
                  : `${fmt(segment.taskStart, tz)} – ${fmt(segment.taskEnd, tz)}`}
              </Text>
              {showTags && (
                <View className="mt-0.5 flex-row flex-wrap gap-1 overflow-hidden">
                  {segment.tags.slice(0, 3).map((t) => (
                    <View key={t} className={cn("rounded border px-1.5 py-0.5", tagTint(t))}>
                      <Text className="text-[9px] font-medium">{t}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}