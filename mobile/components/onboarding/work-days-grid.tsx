import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { DAYS } from "@/utils/preferences";

/**
 * Weekday toggle grid (Mon…Sun pills). Ground truth is the onboarding "Which
 * days?" step; the settings work-days section reuses this exact markup.
 */
export function WorkDaysGrid({
  value,
  onToggle,
  className,
}: {
  value: number[];
  onToggle: (iso: number) => void;
  className?: string;
}) {
  return (
    <View className={cn("flex-row flex-wrap gap-2.5", className)}>
      {DAYS.map((d) => {
        const on = value.includes(d.iso);
        return (
          <Pressable
            key={d.iso}
            onPress={() => onToggle(d.iso)}
            className={cn(
              "h-11 grow basis-[23%] items-center justify-center rounded-xl border px-3.5",
              on ? "border-primary bg-primary" : "border-border bg-card",
            )}
          >
            <Text
              className={cn(
                "text-[14px] font-semibold",
                on ? "text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {d.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
