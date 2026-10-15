import { valueAtX, fractionOf } from "@/lib/slider-math";
import * as Haptics from "expo-haptics";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { cn } from "@/lib/utils";

/**
 * A horizontal track a finger can drag along. The value snaps to `step` and
 * fires one selection haptic each time it moves to a new step. Shared by
 * `DurationSlider` and `TimelineTimePicker`, so both feel the same.
 */
export function SnapTrack({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  accessibilityLabel,
  accessibilityValueText,
  testID,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityValueText: string;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const last = useRef(value);
  // Latest props for the gesture callbacks, which the gesture keeps once.
  const live = useRef({ width, min, max, step, onChange, disabled });
  useLayoutEffect(() => {
    last.current = value;
    live.current = { width, min, max, step, onChange, disabled };
  });

  const gesture = useMemo(() => {
    const apply = (x: number) => {
      const cfg = live.current;
      if (cfg.disabled) return;
      const next = valueAtX(x, cfg.width, cfg.min, cfg.max, cfg.step);
      if (next === last.current) return;
      last.current = next;
      cfg.onChange(next);
      Haptics.selectionAsync().catch(() => {});
    };
    // Gesture handler (not PanResponder) so the drag negotiates with the
    // sheet and scroll view around it: sideways drags are ours, vertical ones
    // fall through to the scroll.
    const pan = Gesture.Pan()
      .minDistance(0)
      .activeOffsetX([-4, 4])
      .failOffsetY([-14, 14])
      .runOnJS(true)
      .onBegin((e) => apply(e.x))
      .onUpdate((e) => apply(e.x));
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => apply(e.x));
    return Gesture.Race(pan, tap);
  }, []);

  function nudge(dir: -1 | 1) {
    if (disabled) return;
    const next = Math.min(max, Math.max(min, value + dir * step));
    if (next !== value) onChange(next);
  }

  const thumbLeft = fractionOf(value, min, max) * width;
  const ticks = Math.floor((max - min) / step);
  const tickEvery = Math.max(1, Math.round(ticks / 16));

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={testID}
        accessible
        accessibilityRole="adjustable"
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) =>
          nudge(e.nativeEvent.actionName === "increment" ? 1 : -1)
        }
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{
          min,
          max,
          now: value,
          text: accessibilityValueText,
        }}
        accessibilityState={{ disabled: !!disabled }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        className="h-11 justify-center"
      >
        <View
          style={{ pointerEvents: "none" }}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <View className="h-full bg-primary/40" style={{ width: thumbLeft }} />
        </View>
        <View
          style={{ pointerEvents: "none" }}
          className="absolute inset-x-0 h-11 flex-row"
        >
          {Array.from({ length: ticks + 1 }, (_, i) => (
            <View
              key={i}
              className={cn(
                "absolute top-[18px] h-[10px] w-px bg-muted-foreground/40",
                i % tickEvery !== 0 && "h-[5px] top-[20px]",
              )}
              style={{ left: width > 0 ? (i / ticks) * width : 0 }}
            />
          ))}
        </View>
        <View
          className="absolute size-7 -ml-3.5 rounded-full border-2 border-primary bg-background shadow-sm"
          style={{ left: thumbLeft, top: 8, pointerEvents: "none" }}
        />
      </View>
    </GestureDetector>
  );
}
