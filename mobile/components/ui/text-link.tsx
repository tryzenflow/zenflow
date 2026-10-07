import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Pressable } from "react-native";

const TONE = {
  muted: "text-muted-foreground",
  foreground: "text-foreground",
  primary: "text-primary-text",
} as const;

/**
 * Inline text action ("Change email", "Try again"). Underlined, announced as a
 * link, and at least 44pt tall so the small type still has a full touch target.
 */
export function TextLink({
  children,
  onPress,
  disabled,
  tone = "muted",
  accessibilityLabel,
  accessibilityHint,
  className,
  textClassName,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: keyof typeof TONE;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={{ left: 8, right: 8 }}
      className={cn(
        "min-h-11 justify-center self-start active:opacity-60",
        disabled && "opacity-50",
        className,
      )}
    >
      <Text
        className={cn(
          "text-[13px] font-semibold underline underline-offset-[3px]",
          TONE[tone],
          textClassName,
        )}
      >
        {children}
      </Text>
    </Pressable>
  );
}
