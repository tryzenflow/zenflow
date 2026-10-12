import { getFileUsage } from "@/api/files";
import { AlertCircle, AlertTriangle, Database } from "@/components/Icons";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useOffline } from "@/hooks/use-offline";
import { useUserStore } from "@/hooks/use-user-store";
import { formatBytes } from "@/lib/file-size";
import { t } from "@/lib/i18n";
import { loadUsageCache, saveUsageCache } from "@/lib/storage-cache";
import { type StorageLevel, storageUsage } from "@/lib/storage-usage";
import type { FileUsage } from "@zenflow/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

const BAR: Record<StorageLevel, string> = {
  ok: "bg-primary",
  warn: "bg-amber-500",
  full: "bg-destructive",
};

/** Warning callout: tinted card, dark same-hue text (light) / light text (dark). */
const CALLOUT: Record<
  Exclude<StorageLevel, "ok">,
  { card: string; text: string }
> = {
  warn: {
    card: "border-amber-500/30 bg-amber-500/15",
    text: "text-amber-800 dark:text-amber-300",
  },
  full: {
    card: "border-destructive/30 bg-destructive/10",
    text: "text-red-800 dark:text-red-300",
  },
};

/** Settings "Storage": how much of the per-user file quota is used, with a warning near the limit. */
export function StorageSection() {
  useLanguage();
  const offline = useOffline();
  const userId = useUserStore((s) => s.user?.id);
  const [usage, setUsage] = useState<FileUsage | null>(null);
  const [settled, setSettled] = useState(false);

  // Last known usage first, so the row has content offline or before the fetch lands.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void loadUsageCache(userId).then((c) => {
      if (active && c) setUsage((cur) => cur ?? c);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  // Refetch on every focus: uploads happen in the task form, not here.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getFileUsage()
        .then((u) => {
          if (!active) return;
          setUsage(u);
          if (userId) void saveUsageCache(userId, u);
        })
        .catch(() => {})
        .finally(() => active && setSettled(true));
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const { percent, level } = usage
    ? storageUsage(usage.usedBytes, usage.userQuotaBytes)
    : { percent: 0, level: "ok" as const };
  const unavailable = !usage && (offline || settled);

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
            {usage ? (
              <Text className="mt-0.5 text-[13px] text-muted-foreground">
                {t("{used} of {total} used", {
                  used: formatBytes(usage.usedBytes),
                  total: formatBytes(usage.userQuotaBytes),
                })}
              </Text>
            ) : unavailable ? (
              <Text className="mt-0.5 text-[13px] text-muted-foreground">
                {offline
                  ? t("Usage is unavailable offline.")
                  : t("Couldn't load your usage.")}
              </Text>
            ) : (
              <Skeleton className="mt-1.5 h-3 w-1/2" />
            )}
          </View>
          {usage && (
            <Text className="text-[15px] font-medium text-muted-foreground">
              {percent}%
            </Text>
          )}
        </View>
        {/* Plain Views, not ui/progress: its spring-animated "%" width is unreliable on native. */}
        <View
          testID="settings.storage-bar"
          role="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          {usage && (
            <View
              className={`h-full rounded-full ${BAR[level]}`}
              style={{
                width: `${Math.max(percent, usage.usedBytes > 0 ? 2 : 0)}%`,
              }}
            />
          )}
        </View>
        {usage && offline && (
          <Text className="mt-2 text-xs text-muted-foreground">
            {t("Offline. Showing your last known usage.")}
          </Text>
        )}
        {level !== "ok" && (
          <View
            testID="settings.storage-warning"
            className={`mt-3 flex-row items-start gap-2 rounded-xl border px-3 py-2.5 ${CALLOUT[level].card}`}
          >
            {level === "full" ? (
              <AlertCircle
                size={16}
                className={`mt-px ${CALLOUT[level].text}`}
              />
            ) : (
              <AlertTriangle
                size={16}
                className={`mt-px ${CALLOUT[level].text}`}
              />
            )}
            <Text
              className={`flex-1 text-[13px] font-medium ${CALLOUT[level].text}`}
            >
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
