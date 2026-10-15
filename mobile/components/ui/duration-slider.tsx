import { useLanguage } from "@/hooks/use-language";
import { locale, t } from "@/lib/i18n";
import { snapToStep } from "@/lib/slider-math";
import { cn } from "@/lib/utils";
import { formatMinutes } from "@zenflow/core";
import { SLOT_MINUTES } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import { SnapTrack } from "./snap-track";
import { Text } from "./text";

/** Readout for a duration in minutes, in the app's language. */
export function durationLabel(minutes: number): string {
  if (locale() !== "vi-VN") return formatMinutes(minutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h} giờ` : ""}${m ? ` ${m} phút` : ""}`.trim();
}

/**
 * Duration picker: a drag track with a tick per 15 minutes, a −/+ pair for
 * one-step taps, and a live readout. Every move snaps to `step` and gives a
 * selection haptic, so a drag reads as a sequence of clicks.
 */
export function DurationSlider({
  value,
  onChange,
  min = SLOT_MINUTES,
  max = 480,
  step = SLOT_MINUTES,
  disabled,
  label,
  valueLabel = durationLabel,
  testID,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** English source string for the accessible name. */
  label: string;
  /** Turns a value into its readout. Defaults to a duration. */
  valueLabel?: (value: number) => string;
  testID?: string;
}) {
  useLanguage();
  const readout = valueLabel(value);

  function step_(delta: number) {
    const next = snapToStep(value + delta, min, max, step);
    if (next === value) return;
    onChange(next);
    Haptics.selectionAsync().catch(() => {});
  }

  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;

  return (
    <View testID={testID} className="gap-2">
      <View className="flex-row items-center gap-3">
        <Pressable
          testID={testID ? `${testID}.minus` : undefined}
          disabled={!canDecrease}
          onPress={() => step_(-step)}
          accessibilityLabel={t("Decrease {field}", { field: t(label) })}
          className={cn(
            "size-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
            !canDecrease && "opacity-40",
          )}
        >
          <Text className="text-2xl text-foreground">−</Text>
        </Pressable>
        <View className="flex-1 items-center">
          <Text
            testID={testID ? `${testID}.value` : undefined}
            accessibilityLiveRegion="polite"
            className="text-[17px] font-semibold tabular-nums text-foreground"
          >
            {readout}
          </Text>
        </View>
        <Pressable
          testID={testID ? `${testID}.plus` : undefined}
          disabled={!canIncrease}
          onPress={() => step_(step)}
          accessibilityLabel={t("Increase {field}", { field: t(label) })}
          className={cn(
            "size-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
            !canIncrease && "opacity-40",
          )}
        >
          <Text className="text-2xl text-foreground">+</Text>
        </Pressable>
      </View>
      <SnapTrack
        testID={testID ? `${testID}.track` : undefined}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        accessibilityLabel={t(label)}
        accessibilityValueText={readout}
      />
    </View>
  );
}
