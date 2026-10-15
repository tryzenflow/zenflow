import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { useTodayStore } from "@/hooks/use-today";
import { format, t } from "@/lib/i18n";
import { summarizeToday } from "@/lib/today-summary";
import { useColorScheme } from "@/lib/useColorScheme";
import { zonedDate } from "@zenflow/core";
import { Pressable, View } from "react-native";

/** Minutes before a task when "in N min" is worth saying. */
const SOON_MINUTES = 90;

/**
 * Today's next task as a glass pill floating over the top of the timeline, so
 * it takes no layout space: the task's title, when it starts and
 * how soon. Reads "All done" or "Nothing planned" when there is no next task.
 */
export function TodayCard({
  tz,
  visible = true,
  onOpenSession,
}: {
  tz: string;
  /** Hide it away from today. */
  visible?: boolean;
  onOpenSession: (taskId: string) => void;
}) {
  useLanguage();
  const sessions = useTodayStore((s) => s.sessions);
  const now = useNow();
  const { isDarkColorScheme } = useColorScheme();
  if (!visible || sessions === null) return null;

  const summary = summarizeToday(sessions, now);
  const next = summary.nextUp;
  const minutes = next
    ? Math.round((new Date(next.startISO).getTime() - now.getTime()) / 60000)
    : 0;
  const soon = minutes >= 1 && minutes <= SOON_MINUTES;

  let title: string;
  let sub: string | null = null;
  if (next) {
    title = next.title;
    sub = t("Next up at {time}", {
      time: format(zonedDate(next.startISO, tz), "h:mm a"),
    });
  } else if (summary.total === 0) title = t("Nothing planned today");
  else if (summary.done === summary.total) title = t("All done for today");
  else title = t("Nothing left today");

  const body = (
    <View className="min-h-12 flex-row items-center gap-3 py-2 pl-4 pr-4">
      <View className="min-w-0 shrink">
        <Text numberOfLines={1} className="text-[15px] font-semibold">
          {title}
        </Text>
        {sub ? (
          <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
            {sub}
          </Text>
        ) : null}
      </View>
      {next && soon ? (
        <View className="rounded-full bg-primary/15 px-2.5 py-1">
          <Text className="text-[12px] font-semibold text-primary">
            {t("in {count} min", { count: minutes })}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View
      testID="today-card"
      pointerEvents="box-none"
      style={{ position: "absolute", top: 8, left: 0, right: 0, zIndex: 10 }}
      className="items-center px-4"
    >
      {/* Outer view carries the shadow only; rounding and clipping live in `Glass`. */}
      <View
        style={{
          maxWidth: "100%",
          borderRadius: 9999,
          shadowColor: "#000",
          shadowOpacity: isDarkColorScheme ? 0.35 : 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <Glass radius={9999} clear intensity={40}>
          {next ? (
            <Pressable
              onPress={() => onOpenSession(next.id)}
              accessibilityRole="button"
              accessibilityLabel={t("Next up: {title}, {time}", {
                title: next.title,
                time: format(zonedDate(next.startISO, tz), "h:mm a"),
              })}
              className="active:opacity-80"
            >
              {body}
            </Pressable>
          ) : (
            body
          )}
        </Glass>
      </View>
    </View>
  );
}
