import { MoonStar, RefreshCcw } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useDluSync } from "@/hooks/use-dlu-sync";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { FONT_SCALE_CAP } from "@/lib/constants";
import type { DayStatus } from "@/lib/day-status";
import { format, t } from "@/lib/i18n";
import { shortAgo } from "@/lib/short-ago";
import { zonedDate } from "@zenflow/core";
import { type Href, useRouter } from "expo-router";
import { Pressable, View } from "react-native";

/** Minutes before a session when "in N min" is worth saying. */
const SOON_MINUTES = 90;

/**
 * Two quiet chips in a row above the timeline (in flow, so they never cover
 * the grid or its hour labels): today's next session (or a calm "done for today"), and a
 * DLU sync note that only appears when sync is stale or failing.
 */
export function DayStatusRow({
  status,
  tz,
  onOpenSession,
}: {
  status: DayStatus;
  tz: string;
  onOpenSession: (taskId: string) => void;
}) {
  useLanguage();
  const router = useRouter();
  const now = useNow();
  const sync = useDluSync();

  const syncText =
    sync.kind === "failing"
      ? t("Sync failing")
      : sync.kind === "stale"
        ? t("Synced {time}", { time: shortAgo(sync.lastSuccessAt, now.getTime()) })
        : null;

  let left = null;
  if (status.kind === "next") {
    const time = format(zonedDate(status.startISO, tz), "h:mm a");
    const minutes = Math.round(
      (new Date(status.startISO).getTime() - now.getTime()) / 60000,
    );
    const rel =
      minutes >= 1 && minutes <= SOON_MINUTES
        ? ` · ${t("in {count} min", { count: minutes })}`
        : "";
    left = (
      <Pressable
        onPress={() => onOpenSession(status.taskId)}
        accessibilityRole="button"
        accessibilityLabel={`${t("Next up: {title}, {time}", { title: status.title, time })}${rel}`}
        hitSlop={{ top: 6, bottom: 6 }}
        className="min-h-9 shrink flex-row items-center gap-2 rounded-full border border-border bg-card/95 px-3 shadow-sm active:opacity-80"
      >
        <View className="size-2 rounded-full bg-primary" />
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}
          className="shrink text-xs"
        >
          <Text className="text-xs font-semibold">{t("Next up")}</Text>
          <Text className="text-xs text-muted-foreground">
            {` · ${time} · ${status.title}${rel}`}
          </Text>
        </Text>
      </Pressable>
    );
  } else if (status.kind === "done") {
    left = (
      <View
        accessible
        className="min-h-9 flex-row items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 shadow-sm"
      >
        <MoonStar size={13} className="text-muted-foreground" />
        <Text
          maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}
          className="text-xs font-medium text-muted-foreground"
        >
          {t("All done for today. Rest up.")}
        </Text>
      </View>
    );
  }

  if (!left && !syncText) return null;
  return (
    <View
      className="flex-row items-center justify-between gap-2 px-3 pb-1.5 pt-1.5"
    >
      <View className="shrink">
        {left}
      </View>
      {syncText ? (
        <Pressable
          onPress={() => router.push("/settings" as Href)}
          accessibilityRole="button"
          accessibilityLabel={`DLU. ${syncText}`}
          accessibilityHint={t("Opens Settings")}
          hitSlop={{ top: 6, bottom: 6 }}
          className="min-h-9 shrink-0 flex-row items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 shadow-sm active:opacity-80"
        >
          <RefreshCcw size={12} className="text-warning" />
          <Text
            maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}
            className="text-xs font-medium text-muted-foreground"
          >
            {`DLU · ${syncText}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
