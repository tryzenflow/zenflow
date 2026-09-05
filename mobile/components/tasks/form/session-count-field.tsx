import { Text } from "@/components/ui/text";
import {
  daysUntilDeadline,
  maxFeasibleSessionCount,
  sessionCadenceLabel,
} from "@/lib/session-count";
import { cn } from "@/lib/utils";
import { MAX_TASK_SESSION_COUNT } from "@zenflow/core";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { clamp, runOnJS, useSharedValue } from "react-native-reanimated";

/** Track/thumb geometry — kept as plain constants (not NativeWind classes)
 * since the drag math needs the pixel values directly. */
const THUMB_SIZE = 24;
const TRACK_HEIGHT = 6;

/**
 * `1..max` range slider for `sessionCount` — replaces the old chevron
 * stepper (issue: "looks dumb" / "hard to understand"). Dragging anywhere on
 * the track snaps the thumb to the nearest integer session count in real
 * time (no continuous/free-form values, no fling physics — a clean
 * snap-to-step like a discrete Android seekbar). The end labels ("1" / max)
 * double as quick-jump taps, matching the old jump-to-ends buttons.
 *
 * The gesture reads `max`/track width off shared values and calls a
 * ref-stabilized `handleChange`, so the `Gesture.Pan` instance itself is
 * built once (`useMemo` with only stable deps below `disabled`/`max`) — it
 * doesn't get torn down and rebuilt mid-drag by the very re-renders the drag
 * itself causes when `onChange` updates `value`.
 */
export function SessionCountField({
  value,
  onChange,
  deadline,
  duration,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  deadline: string | undefined;
  duration: number | undefined;
  disabled?: boolean;
}) {
  const feasible = maxFeasibleSessionCount(deadline, duration);
  const days = daysUntilDeadline(deadline);
  const ceiling = feasible > 0 ? feasible : MAX_TASK_SESSION_COUNT;
  // At most one session per day, on top of whatever fits before the deadline.
  const max = Math.max(1, Math.min(ceiling, days));

  useEffect(() => {
    if (value > max) onChange(max);
  }, [max, value, onChange]);

  // Gesture callbacks read this instead of closing over changing props, so
  // `handleChange` (and the `Gesture.Pan` built from it) stay referentially
  // stable across renders — including the renders a drag itself triggers.
  const latest = useRef({ value, max, disabled, onChange });
  latest.current = { value, max, disabled, onChange };

  const handleChange = useCallback((next: number) => {
    const { value, max, disabled, onChange } = latest.current;
    if (disabled) return;
    const clamped = Math.max(1, Math.min(max, next));
    if (clamped === value) return;
    onChange(clamped);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthSV = useSharedValue(0);
  const maxSV = useSharedValue(max);
  useEffect(() => {
    maxSV.value = max;
  }, [max, maxSV]);

  function onTrackLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    trackWidthSV.value = w;
  }

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && max > 1)
        .minDistance(0)
        .onStart((e) => {
          "worklet";
          const w = trackWidthSV.value;
          const m = maxSV.value;
          if (w <= 0 || m <= 1) return;
          const frac = clamp(e.x / w, 0, 1);
          runOnJS(handleChange)(Math.round(frac * (m - 1)) + 1);
        })
        .onUpdate((e) => {
          "worklet";
          const w = trackWidthSV.value;
          const m = maxSV.value;
          if (w <= 0 || m <= 1) return;
          const frac = clamp(e.x / w, 0, 1);
          runOnJS(handleChange)(Math.round(frac * (m - 1)) + 1);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, max, trackWidthSV, maxSV, handleChange],
  );

  const atMin = disabled || value <= 1;
  const atMax = disabled || value >= max;

  const fraction = max > 1 ? (value - 1) / (max - 1) : 1;
  const usableWidth = Math.max(0, trackWidth - THUMB_SIZE);
  const thumbLeft = fraction * usableWidth;

  return (
    <View className="gap-2">
      <View className="items-center">
        <Text className="text-[17px] font-semibold tabular-nums text-foreground">
          {value} {value === 1 ? "session" : "sessions"}
        </Text>
      </View>

      <View className="flex-row items-center gap-2.5">
        <Pressable
          disabled={atMin}
          onPress={() => handleChange(1)}
          hitSlop={8}
          accessibilityLabel="Reset to 1 session"
        >
          <Text
            className={cn(
              "text-[11px] font-medium tabular-nums text-muted-foreground",
              atMin && "opacity-40",
            )}
          >
            1
          </Text>
        </Pressable>

        <GestureDetector gesture={pan}>
          <View
            onLayout={onTrackLayout}
            className="h-9 flex-1 justify-center"
            accessibilityRole="adjustable"
            accessibilityLabel="Number of sessions"
            accessibilityValue={{ min: 1, max, now: value }}
            accessibilityActions={[
              { name: "increment" },
              { name: "decrement" },
            ]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === "increment") {
                handleChange(value + 1);
              } else if (e.nativeEvent.actionName === "decrement") {
                handleChange(value - 1);
              }
            }}
          >
            <View
              className="rounded-full bg-muted"
              style={{ height: TRACK_HEIGHT }}
            />
            <View
              pointerEvents="none"
              className={cn(
                "absolute rounded-full bg-primary",
                disabled && "opacity-40",
              )}
              style={{
                height: TRACK_HEIGHT,
                width: thumbLeft + THUMB_SIZE / 2,
              }}
            />
            <View
              pointerEvents="none"
              className={cn(
                "absolute rounded-full border-[3px] border-background bg-primary shadow-sm",
                disabled && "opacity-40",
              )}
              style={{
                left: thumbLeft,
                height: THUMB_SIZE,
                width: THUMB_SIZE,
              }}
            />
          </View>
        </GestureDetector>

        <Pressable
          disabled={atMax}
          onPress={() => handleChange(max)}
          hitSlop={8}
          accessibilityLabel={`Fill every day (${max} sessions)`}
        >
          <Text
            className={cn(
              "text-[11px] font-medium tabular-nums text-muted-foreground",
              atMax && "opacity-40",
            )}
          >
            {max}
          </Text>
        </Pressable>
      </View>

      <Text className="text-[11px] text-muted-foreground">
        {sessionCadenceLabel(value, days)}
      </Text>
    </View>
  );
}
