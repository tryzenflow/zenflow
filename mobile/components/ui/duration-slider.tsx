import { StepperButton } from "@/components/ui/stepper-button";
import { useLanguage } from "@/hooks/use-language";
import { durationLabel } from "@/lib/duration-label";
import { t } from "@/lib/i18n";
import { snapToStep } from "@/lib/slider-math";
import { cn } from "@/lib/utils";
import { SLOT_MINUTES } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import { SnapTrack } from "./snap-track";
import { Text } from "./text";

export { durationLabel } from "@/lib/duration-label";

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
        <StepperButton
          testID={testID ? `${testID}.minus` : undefined}
          glyph="−"
          disabled={!canDecrease}
          onPress={() => step_(-step)}
          accessibilityLabel={t("Decrease {field}", { field: t(label) })}
        />
        <View className="flex-1 items-center">
          <Text
            testID={testID ? `${testID}.value` : undefined}
            accessibilityLiveRegion="polite"
            className="text-[17px] font-semibold tabular-nums text-foreground"
          >
            {readout}
          </Text>
        </View>
        <StepperButton
          testID={testID ? `${testID}.plus` : undefined}
          glyph="+"
          disabled={!canIncrease}
          onPress={() => step_(step)}
          accessibilityLabel={t("Increase {field}", { field: t(label) })}
        />
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
