import { useLanguage } from "@/hooks/use-language";
import { Text } from "@/components/ui/text";

/** Sentence-case section label above a grouped settings card (mockups/settings.html). */
export function SettingsSectionLabel({ children }: { children: string }) {
  useLanguage();
  return (
    <Text className="mx-1 mb-2 mt-[22px] text-[13px] font-semibold text-muted-foreground">
      {children}
    </Text>
  );
}
