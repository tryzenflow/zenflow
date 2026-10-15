import { ExpandChevron } from "@/components/ui/expand-chevron";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { OfflineLock } from "@/components/offline-lock";
import { StorageSection } from "@/components/settings/storage-section";
import { TimezoneRow } from "@/components/settings/preferences-section";
import { Text } from "@/components/ui/text";
import { useState } from "react";
import { Pressable, View } from "react-native";

/**
 * The Me tab's Advanced group: timezone and storage, collapsed by default so
 * the everyday settings lead.
 */
export function AdvancedSection() {
  useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen((cur) => !cur)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        testID="settings.advanced"
        className="mx-1 mb-2 mt-[22px] flex-row items-center gap-1.5 active:opacity-70"
      >
        <Text className="text-[13px] font-semibold text-muted-foreground">
          {t("Advanced")}
        </Text>
        <ExpandChevron open={open} size={14} />
      </Pressable>
      {open ? (
        <>
          <TimezoneRow />
          <OfflineLock>
            <StorageSection />
          </OfflineLock>
        </>
      ) : null}
    </>
  );
}
