import { valueAtX, fractionOf } from "@/lib/slider-math";
import * as Haptics from "expo-haptics";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, View } from "react-native";
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
  // Latest props for the gesture handlers, which PanResponder keeps once.
  const live = useRef({ width, min, max, step, onChange, disabled });
  useLayoutEffect(() => {
    last.current = value;
    live.current = { width, min, max, step, onChange, disabled };
  });

  const pan = useMemo(() => {
    const apply = (x: number) => {
      const cfg = live.current;
      if (cfg.disabled) return;
      const next = valueAtX(x, cfg.width, cfg.min, cfg.max, cfg.step);
      if (next === last.current) return;
      last.current = next;
      cfg.onChange(next);
      Haptics.selectionAsync().catch(() => {});
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => apply(e.nativeEvent.locationX),
      onPanResponderMove: (e) => apply(e.nativeEvent.locationX),
    });
  }, []);

  const thumbLeft = fractionOf(value, min, max) * width;
  const ticks = Math.floor((max - min) / step);
  const tickEvery = Math.max(1, Math.round(ticks / 16));

  return (
    <Pressable
      testID={testID}
      accessibilityRole="adjustable"
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
      {...pan.panHandlers}
    >
      <View
        style={{ pointerEvents: "none" }}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <View
          className="h-full bg-primary/40"
          style={{ width: thumbLeft }}
        />
      </View>
      <View style={{ pointerEvents: "none" }} className="absolute inset-x-0 h-11 flex-row">
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
    </Pressable>
  );
}
