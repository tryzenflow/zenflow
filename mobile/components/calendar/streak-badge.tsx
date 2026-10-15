import { Flame } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useTodayStore } from "@/hooks/use-today";
import { t } from "@/lib/i18n";
import { View } from "react-native";

/** The logo's orange. */
const FLAME_ORANGE = "#FF6900";

/** Task streak next to the search button. A filled orange flame once a task is done today, a grey outline before. */
export function StreakBadge() {
  useLanguage();
  const count = useTodayStore((s) => s.streak?.current ?? 0);
  const todayDone = useTodayStore((s) => s.streak?.todayDone ?? false);

  return (
    <View
      testID="calendar-header.streak"
      accessibilityLabel={t("{count} day streak", { count })}
      className="h-11 flex-row items-center gap-1 rounded-full px-1"
    >
      {todayDone ? (
        <Flame size={22} color={FLAME_ORANGE} fill={FLAME_ORANGE} />
      ) : (
        <Flame size={22} className="text-muted-foreground" fill="none" />
      )}
      <Text
        className={
          todayDone
            ? "text-[16px] font-bold"
            : "text-[16px] font-bold text-muted-foreground"
        }
      >
        {count}
      </Text>
    </View>
  );
}
