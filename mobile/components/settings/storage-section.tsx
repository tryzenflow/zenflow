import { getFileUsage } from "@/api/files";
import { AlertTriangle, Database } from "@/components/Icons";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { Progress } from "@/components/ui/progress";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { formatBytes } from "@/lib/file-size";
import { t } from "@/lib/i18n";
import { type StorageLevel, storageUsage } from "@/lib/storage-usage";
import type { FileUsage } from "@zenflow/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

const BAR: Record<StorageLevel, string> = {
  ok: "bg-primary",
  warn: "bg-amber-500",
  full: "bg-destructive",
};

/** Settings "Storage": how much of the per-user file quota is used, with a warning near the limit. */
export function StorageSection() {
  useLanguage();
  const [usage, setUsage] = useState<FileUsage | null>(null);

  // Refetch on every focus: uploads happen in the task form, not here.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getFileUsage()
        .then((u) => active && setUsage(u))
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []),
  );

  // Hidden until the first answer, so an offline first load shows nothing wrong.
  if (!usage) return null;
  const { percent, level } = storageUsage(
    usage.usedBytes,
    usage.userQuotaBytes,
  );

  return (
    <>
      <SettingsSectionLabel>{t("Storage")}</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card px-4 py-3.5">
        <View className="flex-row items-center gap-[13px]">
          <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <Database size={18} className="text-foreground" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold">
              {t("File storage")}
            </Text>
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              {t("{used} of {total} used", {
                used: formatBytes(usage.usedBytes),
                total: formatBytes(usage.userQuotaBytes),
              })}
            </Text>
          </View>
          <Text className="text-[15px] font-medium text-muted-foreground">
            {percent}%
          </Text>
        </View>
        <Progress
          testID="settings.storage-bar"
          value={percent}
          className="mt-3 h-2"
          indicatorClassName={BAR[level]}
        />
        {level !== "ok" && (
          <View
            testID="settings.storage-warning"
            className="mt-3 flex-row items-start gap-2"
          >
            <AlertTriangle
              size={16}
              className={
                level === "full"
                  ? "mt-px text-destructive"
                  : "mt-px text-amber-600 dark:text-amber-400"
              }
            />
            <Text className="flex-1 text-[13px] text-muted-foreground">
              {level === "full"
                ? t(
                    "Storage full. Remove files from your notes to upload more.",
                  )
                : t(
                    "Almost full. Remove files from your notes to free up space.",
                  )}
            </Text>
          </View>
        )}
      </View>
    </>
  );
}
