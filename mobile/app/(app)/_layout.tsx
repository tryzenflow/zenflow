import { Tabs } from "expo-router";
import { Settings } from "@/components/Icons";
import { AppTabBar } from "@/components/tab-bar";
import { DayTabIcon, MonthTabIcon, WeekTabIcon } from "@/components/tab-icons";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function AppTabsLayout() {
  return (
    // Fully custom bar (`components/tab-bar.tsx`): the default one can't draw
    // the convex hump the Optimize button sits on, and its rectangular
    // `shadow*`/`elevation` read as almost nothing against the near-white
    // background.
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
