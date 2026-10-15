import { t } from "@/lib/i18n";
import { useAppUpdate } from "@/hooks/use-app-update";
import { useCourseColourSync } from "@/hooks/use-course-colours";
import { useLanguage } from "@/hooks/use-language";
import { AppTabBar } from "@/components/tab-bar";
import {
  MeTabIcon,
  TodayTabIcon,
  WeekTabIcon,
} from "@/components/tab-icons";
import { Tabs } from "expo-router";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function AppTabsLayout() {
  useLanguage();
  useAppUpdate();
  useCourseColourSync();
  return (
    // Fully custom bar (`components/tab-bar.tsx`): a floating glassmorphic
    // pill — the default edge-to-edge bar's rectangular `shadow*`/`elevation`
    // read as almost nothing against the near-white background.
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false, freezeOnBlur: true }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("Calendar"),
          tabBarIcon: ({ color, size }) => (
            <WeekTabIcon color={color} size={size} />
          ),
        }}
      />
      {/* Opens the calendar on today's Day view (`today.tsx`). */}
      <Tabs.Screen
        name="today"
        options={{
          title: t("Today"),
          tabBarIcon: ({ color, size }) => (
            <TodayTabIcon color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("Me"),
          tabBarIcon: ({ color, size }) => (
            <MeTabIcon color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
