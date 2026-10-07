import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import {
  AlarmClockIcon,
  Bell,
  ChevronRight,
  GraduationCap,
} from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { type SetupItem, pendingSetupItems } from "@/lib/onboarding";
import { Pressable, View } from "react-native";

const ITEMS: Record<SetupItem, { title: string; Icon: typeof Bell }> = {
  notifications: {
    get title() {
      return t("Allow notifications");
    },
    Icon: Bell,
  },
  dlu: {
    get title() {
      return t("Connect your LMS or portal");
    },
    Icon: GraduationCap,
  },
};

/**
 * "Finish setting up Zenflow" — steps skipped during onboarding, derived from
 * real state (not a stored flag), so it disappears once each is done.
 */
export function FinishSetupCard({
  notificationsActive,
  dluConnected,
  onPress,
}: {
  notificationsActive: boolean;
  dluConnected: boolean;
  onPress: (item: SetupItem) => void;
}) {
  useLanguage();
  const items = pendingSetupItems({ notificationsActive, dluConnected });
  if (items.length === 0) return null;
  return (
    <View className="mt-[22px] overflow-hidden rounded-2xl border border-primary/40 bg-primary/10">
      <View className="flex-row items-center justify-between px-4 pb-1 pt-3.5">
        <View className="flex-row items-center gap-2">
          <AlarmClockIcon size={16} className="text-primary" />
          <Text className="text-[15px] font-bold">
            {t("Finish setting up Zenflow")}
          </Text>
        </View>
        <Text className="text-[13px] text-muted-foreground">
          {items.length} {t("left")}
        </Text>
      </View>
      {items.map((item) => {
        const { title, Icon } = ITEMS[item];
        return (
          <Pressable
            key={item}
            onPress={() => onPress(item)}
            className="flex-row items-center gap-[13px] px-4 py-3"
          >
            <Icon size={18} className="text-foreground" />
            <Text className="flex-1 text-[15px] font-semibold">{title}</Text>
            <ChevronRight size={18} className="text-muted-foreground" />
          </Pressable>
        );
      })}
    </View>
  );
}
