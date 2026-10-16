import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { clockLabel, snapToStep } from "@/lib/slider-math";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import { SnapTrack } from "./snap-track";
import { Text } from "./text";
import { cn } from "@/lib/utils";

const DAY_MINUTES = 24 * 60;
const STEP = 15;

/**
 * Start-time picker on a 24-hour timeline. Drag the track or use the −/+
 * pair; the value snaps to 15 minutes. Times are minutes of day, so the
 * result is always on the slot grid. `min` and `max` bound the choice.
 */
export function TimelineTimePicker({
  value,
  onChange,
  min = 0,
  max = DAY_MINUTES - STEP,
  disabled,
  label,
  testID,
}: {
  /** Minutes since midnight, a multiple of 15. */
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** English source string for the accessible name. */
  label: string;
  testID?: string;
}) {
  useLanguage();
  const readout = clockLabel(value);

  function nudge(delta: number) {
    const next = snapToStep(value + delta, min, max, STEP);
    if (next === value) return;
    onChange(next);
    Haptics.selectionAsync().catch(() => {});
  }

  const canEarlier = !disabled && value > min;
  const canLater = !disabled && value < max;

  return (
    <View testID={testID} className="gap-2">
      <View className="flex-row items-center gap-3">
        <Pressable
          testID={testID ? `${testID}.earlier` : undefined}
          disabled={!canEarlier}
          onPress={() => nudge(-STEP)}
          accessibilityLabel={t("Earlier by 15 minutes")}
          className={cn(
            "size-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
            !canEarlier && "opacity-40",
          )}
        >
          <Text className="text-2xl text-foreground">−</Text>
        </Pressable>
        <View className="flex-1 items-center">
          <Text
            testID={testID ? `${testID}.value` : undefined}
            accessibilityLiveRegion="polite"
            className="text-[22px] font-bold tabular-nums tracking-tight text-foreground"
          >
            {readout}
          </Text>
        </View>
        <Pressable
          testID={testID ? `${testID}.later` : undefined}
          disabled={!canLater}
          onPress={() => nudge(STEP)}
          accessibilityLabel={t("Later by 15 minutes")}
          className={cn(
            "size-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
            !canLater && "opacity-40",
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
        step={STEP}
        disabled={disabled}
        accessibilityLabel={t(label)}
        accessibilityValueText={readout}
      />
      <View className="flex-row justify-between px-0.5">
        {["00:00", "06:00", "12:00", "18:00", "24:00"].map((h) => (
          <Text key={h} className="text-[11px] tabular-nums text-muted-foreground">
            {h}
          </Text>
        ))}
      </View>
    </View>
  );
}
