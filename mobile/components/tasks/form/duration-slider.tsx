import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const THUMB_SIZE = 26;

/**
 * 15-minute-step duration slider for `ChangeDurationSheet` — the mobile
 * replacement for the web's pointer-driven top/bottom resize handles (too
 * small to reliably hit with a finger; see `docs/react-native-migration.md`
 * Phase 2's "Resize task" row). Built on `react-native-gesture-handler`'s
 * modern `Gesture.Pan()` API + `react-native-reanimated`, per the stack this
 * migration already standardized on for drag interactions.
 *
 * The thumb's screen position updates on every committed 15-min step (not
 * continuously per drag-frame) — a deliberate simplification: true 60fps
 * continuous tracking would need a second, UI-thread-only shared value kept
 * in sync with the (JS-side, prop-controlled) `value`, which is real added
 * complexity for a slider whose whole point is that it only ever *lands* on
 * a 15-min grid anyway. Each step still animates in with `withTiming` so the
 * motion doesn't feel like a hard cut, and a haptic fires on every step
 * crossing (checklist: "haptic on stepper/slider snap steps").
 */
export function DurationSlider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const trackWidthRef = useRef(0);
  trackWidthRef.current = trackWidth;
  const startValueRef = useRef(value);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const commit = useCallback(
    (raw: number) => {
      const clamped = Math.min(max, Math.max(min, raw));
      const snapped = Math.round(clamped / step) * step;
      if (snapped !== valueRef.current) {
        valueRef.current = snapped;
        onChange(snapped);
        Haptics.selectionAsync().catch(() => {});
      }
    },
    [min, max, step, onChange],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-8, 8])
    .onBegin(() => {
      startValueRef.current = valueRef.current;
    })
    .onUpdate((e) => {
      "worklet";
      const width = trackWidthRef.current;
      if (width <= 0) return;
      const range = max - min;
      const deltaValue = (e.translationX / width) * range;
      runOnJS(commit)(startValueRef.current + deltaValue);
    });

  const pct =
    max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;

  const thumbStyle = useAnimatedStyle(() => ({
    left: withTiming(`${pct * 100}%`, { duration: 120 }),
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: withTiming(`${pct * 100}%`, { duration: 120 }),
  }));

  const ticks = tickLabels(min, max, step);

  return (
    <View className="gap-1.5">
      <View
        onLayout={onLayout}
        className="relative h-11 justify-center"
        hitSlop={{ top: 12, bottom: 12 }}
      >
        <View className="h-1.5 w-full rounded-full bg-muted">
          <Animated.View
            className="h-1.5 rounded-full bg-primary"
            style={fillStyle}
          />
        </View>
        <GestureDetector gesture={pan}>
          <Animated.View
            className="absolute top-1/2 h-[26px] w-[26px] items-center justify-center rounded-full border border-border bg-white shadow"
            style={[
              thumbStyle,
              {
                marginTop: -THUMB_SIZE / 2,
                marginLeft: -THUMB_SIZE / 2,
              },
            ]}
          />
        </GestureDetector>
      </View>
      <View className="flex-row justify-between">
        {ticks.map((t) => (
          <Animated.Text
            key={t}
            className="text-[11px] tabular-nums text-muted-foreground"
          >
            {formatTick(t)}
          </Animated.Text>
        ))}
      </View>
    </View>
  );
}

/** A handful of evenly-spaced minute labels under the track, mirroring the
 * mockup's "15 30 45 60 75 90…" caption row — capped at 7 labels so it
 * doesn't overflow on wide ranges. */
function tickLabels(min: number, max: number, step: number): number[] {
  const totalSteps = Math.round((max - min) / step);
  const labelCount = Math.min(totalSteps + 1, 7);
  const stride = Math.max(1, Math.round(totalSteps / (labelCount - 1)));
  const labels: number[] = [];
  for (let i = 0; i <= totalSteps; i += stride) {
    labels.push(min + i * step);
  }
  if (labels[labels.length - 1] !== max) labels.push(max);
  return labels;
}

/** Compact tick caption — `15m`, `1h`, `1h15m` — distinct from `formatMinutes`'s
 * spelled-out "1 h 15 min" used elsewhere, since these labels sit tightly
 * packed under the track. */
function formatTick(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes}m`;
}
