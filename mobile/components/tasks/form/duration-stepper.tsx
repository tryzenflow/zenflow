import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { formatMinutes } from "@zenflow/core";
import { DAILY_HORIZON, SLOT_MINUTES } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";

/**
 * −/+ duration stepper (create-task-sheet's replacement for the web's
 * hour/minute `<Select>` pair) — always moves in `SLOT_MINUTES` (15-minute)
 * steps and clamps to `taskSchema`'s bounds
 * (`[SLOT_MINUTES, DAILY_HORIZON]`), matching `mockups/task-sheets.html`'s
 * "Duration" field. A light selection haptic fires on every successful step,
 * per the checklist's "haptic on stepper/slider snap steps".
 */
export function DurationStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  function step(delta: number) {
    const next = Math.min(DAILY_HORIZON, Math.max(SLOT_MINUTES, value + delta));
    if (next === value) return;
    onChange(next);
    Haptics.selectionAsync().catch(() => {});
  }

  const canDecrement = !disabled && value > SLOT_MINUTES;
  const canIncrement = !disabled && value < DAILY_HORIZON;

  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        disabled={!canDecrement}
        onPress={() => step(-SLOT_MINUTES)}
        accessibilityLabel="Decrease duration by 15 minutes"
        className={cn(
          "h-11 w-11 items-center justify-center rounded-xl border border-input bg-card",
          !canDecrement && "opacity-40",
        )}
      >
        <Text className="text-2xl text-foreground">−</Text>
      </Pressable>
      <View className="flex-1 items-center">
        <Text className="text-[17px] font-semibold tabular-nums text-foreground">
          {formatMinutes(value)}
        </Text>
      </View>
      <Pressable
        disabled={!canIncrement}
        onPress={() => step(SLOT_MINUTES)}
        accessibilityLabel="Increase duration by 15 minutes"
        className={cn(
          "h-11 w-11 items-center justify-center rounded-xl border border-input bg-card",
          !canIncrement && "opacity-40",
        )}
      >
        <Text className="text-2xl text-foreground">+</Text>
      </Pressable>
    </View>
  );
}
