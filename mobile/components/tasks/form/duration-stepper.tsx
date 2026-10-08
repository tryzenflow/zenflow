import { useLanguage } from "@/hooks/use-language";
import { t, locale } from "@/lib/i18n";
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
  useLanguage();
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
        accessibilityLabel={t("Decrease duration by 15 minutes")}
        className={cn(
          "h-11 w-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
          !canDecrement && "opacity-40",
        )}
      >
        <Text className="text-2xl text-foreground">−</Text>
      </Pressable>
      <View className="flex-1 items-center">
        <Text className="text-[17px] font-semibold tabular-nums text-foreground">
          {locale() === "vi-VN"
            ? `${Math.floor(value / 60) ? `${Math.floor(value / 60)} giờ` : ""}${value % 60 ? ` ${value % 60} phút` : ""}`.trim()
            : formatMinutes(value)}
        </Text>
      </View>
      <Pressable
        disabled={!canIncrement}
        onPress={() => step(SLOT_MINUTES)}
        accessibilityLabel={t("Increase duration by 15 minutes")}
        className={cn(
          "h-11 w-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
          !canIncrement && "opacity-40",
        )}
      >
        <Text className="text-2xl text-foreground">+</Text>
      </Pressable>
    </View>
  );
}
