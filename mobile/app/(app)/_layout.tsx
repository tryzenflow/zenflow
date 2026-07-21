import { Tabs } from "expo-router";
import { Settings } from "@/components/Icons";
import { DayTabIcon, MonthTabIcon, WeekTabIcon } from "@/components/tab-icons";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/useColorScheme";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function AppTabsLayout() {
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.mutedForeground,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopWidth: 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          shadowColor: theme.primary,
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.25,
          shadowRadius: 12,
          elevation: 12,
        },
      }}
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
