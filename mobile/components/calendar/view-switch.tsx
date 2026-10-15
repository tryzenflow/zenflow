import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Pressable, View } from "react-native";

export type CalendarView = "day" | "week" | "month";

const VIEWS: readonly { id: CalendarView; label: () => string }[] = [
  { id: "day", label: () => t("Day") },
  { id: "week", label: () => t("Week") },
  { id: "month", label: () => t("Month") },
];

interface ViewSwitchProps {
  value: CalendarView;
  onChange: (view: CalendarView) => void;
}

/** Segmented Day | Week | Month control in the calendar header. */
export function ViewSwitch({ value, onChange }: ViewSwitchProps) {
  useLanguage();
  return (
    <View
      accessibilityRole="tablist"
      className="flex-row rounded-full bg-muted p-0.5"
    >
      {VIEWS.map(({ id, label }) => {
        const selected = id === value;
        return (
          <Pressable
            key={id}
            onPress={() => {
              if (!selected) onChange(id);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            accessibilityLabel={label()}
            testID={`view-switch.${id}`}
            hitSlop={6}
            className={cn(
              "h-8 items-center justify-center rounded-full",
              "min-w-[52px] px-3",
              selected ? "bg-card" : "bg-transparent",
            )}
          >
            <Text
              className={cn(
                "text-[13px] font-semibold",
                selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
