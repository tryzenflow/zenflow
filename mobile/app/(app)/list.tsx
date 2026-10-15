import { SessionAgenda } from "@/components/calendar/session-agenda";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { CreateSessionFab } from "@/components/tasks/create-task-fab";
import { useOffline } from "@/hooks/use-offline";
import { useUserStore } from "@/hooks/use-user-store";
import { Search } from "@/components/Icons";
import { StreakBadge } from "@/components/calendar/streak-badge";
import { SessionSearchView } from "@/components/calendar/session-search-view";
import { NotificationBell } from "@/components/notification-bell";
import { GlassButton } from "@/components/ui/glass-button";
import { t } from "@/lib/i18n";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The List tab: every session in order, with the same agenda the search uses. */
export default function ListScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const offline = useOffline();
  const [searchOpen, setSearchOpen] = useState(false);
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center gap-2 px-4 pb-2"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Text className="flex-1 text-[28px] font-bold">{t("List")}</Text>
        <StreakBadge />
        <GlassButton
          icon={Search}
          accessibilityLabel={t("Search sessions")}
          onPress={() => setSearchOpen(true)}
          testID="list.search"
        />
        <NotificationBell />
      </View>
      <SessionAgenda term="" />
      <CreateSessionFab tz={tz} hidden={offline} />
      {searchOpen ? <SessionSearchView onClose={() => setSearchOpen(false)} /> : null}
    </View>
  );
}
