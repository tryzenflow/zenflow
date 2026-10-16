import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import type { ComponentType, ReactNode } from "react";
import { View } from "react-native";
import { Text } from "./text";

/**
 * A labelled group for one field in a composer sheet. Every input sits inside
 * one, so a bare field never reaches the sheet. `error` reads as one calm line
 * under the content: no red fill, no alert icon.
 */
export function FieldCard({
  label,
  icon: Icon,
  hint,
  error,
  trailing,
  testID,
  children,
}: {
  /** English source string, translated here. */
  label: string;
  /** Small leading icon (the app's Icons). */
  icon?: ComponentType<{ size?: number; className?: string }>;
  hint?: string;
  /** English source string of a validation message, translated here. */
  error?: string;
  trailing?: ReactNode;
  testID?: string;
  children: ReactNode;
}) {
  useLanguage();
  return (
    <View
      testID={testID}
      className="gap-2.5 rounded-2xl border border-glass-edge/30 bg-glass/60 p-3.5 dark:border-glass-edge/20 dark:bg-glass/[0.06]"
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          {Icon ? <Icon size={15} className="text-primary" /> : null}
          <Text className="text-[13px] font-semibold text-foreground">
            {t(label)}
          </Text>
        </View>
        {trailing}
      </View>
      {children}
      {!!hint && !error && (
        <Text className="text-[12px] leading-snug text-muted-foreground">
          {t(hint)}
        </Text>
      )}
      {!!error && (
        <Text
          accessibilityLiveRegion="polite"
          className="text-[12.5px] font-medium leading-snug text-destructive"
        >
          {t(error)}
        </Text>
      )}
    </View>
  );
}
