import { Settings } from "@/components/Icons";
import { AppTabBar } from "@/components/tab-bar";
import { DayTabIcon, MonthTabIcon, WeekTabIcon } from "@/components/tab-icons";
import { Tabs } from "expo-router";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function AppTabsLayout() {
  return (
    // Fully custom bar (`components/tab-bar.tsx`): a floating glassmorphic
    // pill — the default edge-to-edge bar's rectangular `shadow*`/`elevation`
    // read as almost nothing against the near-white background.
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Day",
          tabBarIcon: ({ color, size }) => (
            <DayTabIcon color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="week"
        options={{
          title: "Week",
          tabBarIcon: ({ color, size }) => (
            <WeekTabIcon color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="month"
        options={{
          title: "Month",
          tabBarIcon: ({ color, size }) => (
            <MonthTabIcon color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Settings color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
