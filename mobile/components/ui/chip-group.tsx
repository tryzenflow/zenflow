import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Pressable, View } from "react-native";
import { Text } from "./text";

export interface ChipOption<T extends string> {
  value: T;
  /** English source string, translated here. */
  label: string;
}

/**
 * One-tap choice among 3 to 5 short options, plus an optional Custom chip that
 * reveals a finer control. Keep the set short: the smart default should cover
 * most taps, and Custom covers the rest.
 */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  onCustom,
  customActive = false,
  customLabel,
  disabled,
  testID,
}: {
  options: ChipOption<T>[];
  /** `null` when no option applies (for example while Custom is showing). */
  value: T | null;
  onChange: (value: T) => void;
  /** Shows the Custom chip when given. */
  onCustom?: () => void;
  customActive?: boolean;
  /** English source string; defaults to "Custom". */
  customLabel?: string;
  disabled?: boolean;
  testID?: string;
}) {
  useLanguage();
  return (
    <View className="flex-row flex-wrap gap-2" testID={testID}>
      {options.map((o) => (
        <Chip
          key={o.value}
          label={t(o.label)}
          active={!customActive && value === o.value}
          disabled={disabled}
          testID={testID ? `${testID}.${o.value}` : undefined}
          onPress={() => onChange(o.value)}
        />
      ))}
      {onCustom && (
        <Chip
          label={t(customLabel ?? "Custom")}
          active={customActive}
          disabled={disabled}
          testID={testID ? `${testID}.custom` : undefined}
          onPress={onCustom}
        />
      )}
    </View>
  );
}

/** One chip. Also used on its own by multi-select rows (weekdays). */
export function Chip({
  label,
  active,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={active}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "h-10 min-w-[44px] items-center justify-center rounded-full border border-border bg-muted px-5",
        active && "border-primary/50 bg-primary/15",
        disabled && "opacity-50",
      )}
    >
      <Text
        className={cn(
          "text-[15px] font-semibold leading-5 text-muted-foreground",
          active && "text-primary",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
