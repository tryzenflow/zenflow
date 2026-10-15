import { GlassButton } from "@/components/ui/glass-button";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { NAV_THEME } from "@/lib/constants";
import type { DayStatus } from "@/lib/day-status";
import { format, t } from "@/lib/i18n";
import { useColorScheme } from "@/lib/useColorScheme";
import { zonedDate } from "@zenflow/core";
import { View } from "react-native";

/** Minutes before a session when "in N min" is worth saying. */
const SOON_MINUTES = 90;

/**
 * Today's next session as a small glass pill, floating at the top centre of the
 * timeline — the same translucent fill, hairline border and top sheen as the
 * floating tab bar. Renders nothing when there is no next session.
 */
export function NextUpPill({
  status,
  tz,
  onOpenSession,
}: {
  status: DayStatus;
  tz: string;
  onOpenSession: (taskId: string) => void;
}) {
  useLanguage();
  const now = useNow();
  const { isDarkColorScheme } = useColorScheme();
  if (status.kind !== "next") return null;

  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;

  const time = format(zonedDate(status.startISO, tz), "h:mm a");
  const minutes = Math.round(
    (new Date(status.startISO).getTime() - now.getTime()) / 60000,
  );
  const rel =
    minutes >= 1 && minutes <= SOON_MINUTES
      ? ` ${t("in {count} min", { count: minutes })}`
      : "";

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: 8, left: 0, right: 0, zIndex: 10 }}
      className="items-center px-6"
    >
      <View style={{ maxWidth: "100%" }}>
        <GlassButton
          onPress={() => onOpenSession(status.taskId)}
          accessibilityLabel={`${t("Next up: {title}, {time}", { title: status.title, time })}${rel}`}
          haptic={false}
        >
          <View className="shrink flex-row items-center gap-2">
            <View
              className="size-2 rounded-full"
              style={{ backgroundColor: theme.primary }}
            />
            <Text numberOfLines={1} className="shrink text-xs">
              <Text className="text-xs font-semibold">{t("Next up")}</Text>
              <Text className="text-xs text-muted-foreground">
                {` ${time}, ${status.title}${rel}`}
              </Text>
            </Text>
          </View>
        </GlassButton>
      </View>
    </View>
  );
}
