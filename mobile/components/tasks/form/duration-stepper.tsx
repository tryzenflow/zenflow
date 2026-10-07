import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Check } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { durationLabel } from "@/lib/duration-label";
import { DURATION_PRESETS } from "@/lib/form-validation";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { DAILY_HORIZON, SLOT_MINUTES } from "@zenflow/shared";
import { Pressable, View } from "react-native";

/**
 * −/+ duration stepper (create-task-sheet's replacement for the web's
 * hour/minute `<Select>` pair) — always moves in `SLOT_MINUTES` (15-minute)
 * steps and clamps to `taskSchema`'s bounds
 * (`[SLOT_MINUTES, DAILY_HORIZON]`), matching `mockups/task-sheets.html`'s
 * "Duration" field. Preset chips (30 / 60 / 90 / 120 min) jump straight to the
 * common lengths; the stepper fine-tunes in 15-minute steps. A selection haptic
 * fires on every change.
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
  useLanguage();
  function step(delta: number) {
    const next = Math.min(DAILY_HORIZON, Math.max(SLOT_MINUTES, value + delta));
    if (next === value) return;
    onChange(next);
    haptic.select();
  }
  function pickPreset(minutes: number) {
    if (minutes === value) return;
    onChange(minutes);
    haptic.select();
  }

  const canDecrement = !disabled && value > SLOT_MINUTES;
  const canIncrement = !disabled && value < DAILY_HORIZON;

  return (
    <View className="gap-3">
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Common durations")}
        className="flex-row gap-2"
      >
        {DURATION_PRESETS.map((minutes) => {
          const selected = value === minutes;
          return (
            <Pressable
              key={minutes}
              disabled={disabled}
              onPress={() => pickPreset(minutes)}
              accessibilityRole="radio"
              accessibilityLabel={durationLabel(minutes)}
              accessibilityState={{ selected, disabled: !!disabled }}
              className={cn(
                "min-h-11 flex-1 flex-row items-center justify-center gap-1 rounded-xl border px-1.5 py-1.5",
                selected
                  ? "border-2 border-primary-text bg-primary/15"
                  : "border-input bg-card",
                disabled && "opacity-50",
              )}
            >
              {selected && <Check size={13} className="text-primary-text" />}
              <Text
                className={cn(
                  "shrink text-center text-[13px] font-semibold",
                  selected ? "text-primary-text" : "text-foreground",
                )}
              >
                {durationLabel(minutes)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row items-center gap-3">
      <Pressable
        disabled={!canDecrement}
        onPress={() => step(-SLOT_MINUTES)}
        accessibilityRole="button"
        accessibilityLabel={t("Decrease duration by 15 minutes")}
        className={cn(
          "h-11 w-11 items-center justify-center rounded-xl border border-input bg-card",
          !canDecrement && "opacity-40",
        )}
      >
        <Text className="text-2xl text-foreground">−</Text>
      </Pressable>
      <View
        className="flex-1 items-center"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t("Duration: {value}", {
          value: durationLabel(value),
        })}
        accessibilityActions={[
          { name: "increment" },
          { name: "decrement" },
        ]}
        onAccessibilityAction={(e) =>
          step(e.nativeEvent.actionName === "increment" ? SLOT_MINUTES : -SLOT_MINUTES)
        }
      >
        <Text className="text-[17px] font-semibold tabular-nums text-foreground">
          {durationLabel(value)}
        </Text>
      </View>
      <Pressable
        disabled={!canIncrement}
        onPress={() => step(SLOT_MINUTES)}
        accessibilityRole="button"
        accessibilityLabel={t("Increase duration by 15 minutes")}
        className={cn(
          "h-11 w-11 items-center justify-center rounded-xl border border-input bg-card",
          !canIncrement && "opacity-40",
        )}
      >
        <Text className="text-2xl text-foreground">+</Text>
      </Pressable>
      </View>
    </View>
  );
}
