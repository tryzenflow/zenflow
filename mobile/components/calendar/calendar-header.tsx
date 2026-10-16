import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Search } from "@/components/Icons";
import { NotificationBell } from "@/components/notification-bell";
import { OfflineIndicator } from "@/components/offline-indicator";
import { GlassButton } from "@/components/ui/glass-button";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "react-native";
import { type CalendarView, ViewSwitch } from "./view-switch";

interface CalendarHeaderProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  /** Key for the offline indicator, so it re-reads when the focused range changes. */
  offlineKey: string;
  onSearch: () => void;
}

/**
 * The calendar screen's top bar: the Day | Week | Month switch on the left;
 * search and the notification bell on the right.
 * Every view sits under it.
 */
export function CalendarHeader({
  view,
  onViewChange,
  offlineKey,
  onSearch,
}: CalendarHeaderProps) {
  useLanguage();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row items-center gap-2 bg-background px-4 pb-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <ViewSwitch value={view} onChange={onViewChange} />
      <View className="min-w-0 flex-1 flex-row items-center justify-end gap-2">
        <OfflineIndicator dayKey={offlineKey} />
        <GlassButton
          icon={Search}
          accessibilityLabel={t("Search sessions")}
          onPress={onSearch}
          testID="calendar-header.search"
        />
        <NotificationBell />
      </View>
    </View>
  );
}
