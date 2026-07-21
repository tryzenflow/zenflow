import { Text } from "@/components/ui/text";

/** Uppercase section label above a grouped settings card (mockups/settings.html). */
export function SettingsSectionLabel({ children }: { children: string }) {
  return (
    <Text className="mx-1 mb-2 mt-[22px] text-xs font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </Text>
  );
}
