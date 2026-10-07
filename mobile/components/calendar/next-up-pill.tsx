import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { NAV_THEME } from "@/lib/constants";
import type { DayStatus } from "@/lib/day-status";
import { format, t } from "@/lib/i18n";
import { useColorScheme } from "@/lib/useColorScheme";
import { zonedDate } from "@zenflow/core";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, View } from "react-native";

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
  const tint = isDarkColorScheme
    ? "rgba(29, 26, 23, 0.78)"
    : "rgba(255, 255, 255, 0.72)";
  const borderColor = isDarkColorScheme
    ? "rgba(255, 255, 255, 0.14)"
    : "rgba(255, 255, 255, 0.55)";
  const sheen: [string, string, string] = isDarkColorScheme
    ? ["rgba(255,255,255,0.10)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0)"]
    : ["rgba(255,255,255,0.85)", "rgba(255,255,255,0.30)", "rgba(255,255,255,0)"];

  const time = format(zonedDate(status.startISO, tz), "h:mm a");
  const minutes = Math.round(
    (new Date(status.startISO).getTime() - now.getTime()) / 60000,
  );
  const rel =
    minutes >= 1 && minutes <= SOON_MINUTES
      ? ` · ${t("in {count} min", { count: minutes })}`
      : "";

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: 8, left: 0, right: 0, zIndex: 10 }}
      className="items-center px-6"
    >
      {/* Outer view carries the shadow only; rounding + clipping live inside. */}
      <View
        style={{
          maxWidth: "100%",
          borderRadius: 9999,
          shadowColor: "#000",
          shadowOpacity: isDarkColorScheme ? 0.4 : 0.14,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
          backgroundColor: "rgba(255, 255, 255, 0.7)",
        }}
      >
        <Pressable
          onPress={() => onOpenSession(status.taskId)}
          accessibilityRole="button"
          accessibilityLabel={`${t("Next up: {title}, {time}", { title: status.title, time })}${rel}`}
          style={{
            borderRadius: 9999,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor,
            overflow: "hidden",
            backgroundColor: tint,
          }}
          className="active:opacity-80"
        >
          <LinearGradient
            pointerEvents="none"
            colors={sheen}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View className="min-h-9 flex-row items-center gap-2 px-3.5">
            <View
              className="size-2 rounded-full"
              style={{ backgroundColor: theme.primary }}
            />
            <Text numberOfLines={1} className="shrink text-xs">
              <Text className="text-xs font-semibold">{t("Next up")}</Text>
              <Text className="text-xs text-muted-foreground">
                {` · ${time} · ${status.title}${rel}`}
              </Text>
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
