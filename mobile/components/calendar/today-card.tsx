import { Shield } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { useTodayLoader, useTodayStore } from "@/hooks/use-today";
import { NAV_THEME } from "@/lib/constants";
import { format, t } from "@/lib/i18n";
import {
  formatHours,
  greetingKey,
  summarizeToday,
} from "@/lib/today-summary";
import { useColorScheme } from "@/lib/useColorScheme";
import { BRAND, zonedDate, zonedNow } from "@zenflow/core";
import { Pressable, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

const RING_SIZE = 52;
const RING_STROKE = 5;

const GREETINGS = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
} as const;

/** A track with a sun arc for the share of today's sessions that are done. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const { isDarkColorScheme } = useColorScheme();
  const track = (isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light).border;
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total === 0 ? 0 : Math.min(done / total, 1);
  return (
    <View
      style={{ width: RING_SIZE, height: RING_SIZE }}
      className="items-center justify-center"
    >
      <Svg width={RING_SIZE} height={RING_SIZE} style={{ position: "absolute" }}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          stroke={track}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          testID="today-ring-arc"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          stroke={BRAND.orange}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </Svg>
      <Text className="text-[12px] font-bold">{`${done}/${total}`}</Text>
    </View>
  );
}

/**
 * Today at a glance, above the week timeline: greeting, date, sessions and
 * hours, the progress ring, the next session, and the streak with its freezes.
 * Replaces the floating next-up pill.
 */
export function TodayCard({
  tz,
  onOpenSession,
}: {
  tz: string;
  onOpenSession: (taskId: string) => void;
}) {
  useLanguage();
  useTodayLoader(tz);
  const sessions = useTodayStore((s) => s.sessions);
  const streak = useTodayStore((s) => s.streak);
  const now = useNow();
  const { isDarkColorScheme } = useColorScheme();

  const wall = zonedNow(tz);
  const summary = summarizeToday(sessions ?? [], now);
  const streakDays = streak?.current ?? 0;
  const freezes = streak?.freezesAvailable ?? 0;

  let nextLine: string;
  if (summary.total === 0) nextLine = t("Nothing planned today");
  else if (summary.nextUp) {
    nextLine = t("Next up: {title}, {time}", {
      title: summary.nextUp.title,
      time: format(zonedDate(summary.nextUp.startISO, tz), "h:mm a"),
    });
  } else {
    nextLine =
      summary.done === summary.total
        ? t("All done for today")
        : t("Nothing left today");
  }

  return (
    <View
      testID="today-card"
      className="mx-4 mt-2 flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
    >
      <ProgressRing done={summary.done} total={summary.total} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-[16px] font-bold" numberOfLines={1}>
          {t(GREETINGS[greetingKey(wall.getHours())])}
        </Text>
        <Text className="text-[12px] text-muted-foreground" numberOfLines={1}>
          {format(wall, "EEE, MMM d")}
        </Text>
        <Text className="text-[12px] text-muted-foreground" numberOfLines={1}>
          {t("{count} sessions, {hours} h", {
            count: summary.total,
            hours: formatHours(summary.plannedMinutes),
          })}
        </Text>
        {summary.nextUp ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nextLine}
            onPress={() => onOpenSession(summary.nextUp?.id ?? "")}
            hitSlop={6}
          >
            <Text className="text-[12px] font-semibold text-primary" numberOfLines={1}>
              {nextLine}
            </Text>
          </Pressable>
        ) : (
          <Text className="text-[12px] font-semibold text-primary" numberOfLines={1}>
            {nextLine}
          </Text>
        )}
      </View>
      <View className="items-end gap-1">
        <Text className="text-[13px] font-bold" testID="today-streak">
          {streakDays > 0
            ? t("{count} day streak", { count: streakDays })
            : t("No streak yet")}
        </Text>
        {freezes > 0 ? (
          <View className="flex-row items-center gap-1 rounded-full bg-secondary px-2 py-0.5">
            <Shield size={11} className="text-primary" />
            <Text className="text-[11px] font-semibold text-primary">
              {t("{count} freeze ready", { count: freezes })}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
