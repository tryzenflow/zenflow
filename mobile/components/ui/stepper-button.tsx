import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Pressable } from "react-native";

/** The − and + buttons of a stepper. One look in light and dark. */
export function StepperButton({
  glyph,
  onPress,
  disabled,
  accessibilityLabel,
  testID,
}: {
  glyph: "−" | "+";
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={cn(
        "size-11 items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
        disabled && "opacity-40",
      )}
    >
      <Text className="text-2xl text-foreground">{glyph}</Text>
    </Pressable>
  );
}
