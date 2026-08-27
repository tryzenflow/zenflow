import { logout as logoutRequest } from "@/api/auth";
import { LogOut, Moon } from "@/components/Icons";
import { ProfileRow } from "@/components/settings/profile-row";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useUserStore } from "@/hooks/use-user-store";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { clearSession } from "@/lib/api-client";
import { clearCachedSessionUser } from "@/lib/session";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { useColorScheme } from "@/lib/useColorScheme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Href, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

/** Single flat Settings screen — mirrors mockups/settings.html exactly. */
export default function SettingsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);
  const { isDarkColorScheme, setColorScheme } = useColorScheme();
  const [loggingOut, setLoggingOut] = useState(false);

  function toggleDarkMode() {
    const next = isDarkColorScheme ? "light" : "dark";
    setColorScheme(next);
    setAndroidNavigationBar(next);
    AsyncStorage.setItem("theme", next);
  }

  async function handleSignOut() {
    setLoggingOut(true);
    try {
      await logoutRequest();
    } catch {
      // Best-effort — clear the local session regardless of API result.
    }
    await clearSession();
    await clearCachedSessionUser();
    setUser(null);
    setLoggingOut(false);
    router.replace("/(auth)/login" as Href);
  }

  const tabBarOverlay = useTabBarOverlayHeight();

  if (!user) return null;

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border bg-background px-6 py-4">
        <Text className="text-xl font-bold tracking-tight">Settings</Text>
      </View>
      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: tabBarOverlay + 32 }}
      >
        <SettingsSectionLabel>Profile</SettingsSectionLabel>
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          <ProfileRow user={user} onUpdated={setUser} />
        </View>

        <SettingsSectionLabel>Appearance</SettingsSectionLabel>
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          <View className="flex-row items-center gap-[13px] bg-card px-4 py-3.5">
            <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
              <Moon size={18} className="text-foreground" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-semibold">Dark mode</Text>
              <Text className="mt-0.5 text-[13px] text-muted-foreground">
                Follow the warm-sunrise night palette
              </Text>
            </View>
            <Switch
              checked={isDarkColorScheme}
              onCheckedChange={toggleDarkMode}
            />
          </View>
        </View>

        <SettingsSectionLabel>Account</SettingsSectionLabel>
        <View className="mb-[18px] overflow-hidden rounded-2xl border border-border bg-card">
          <Pressable
            onPress={handleSignOut}
            disabled={loggingOut}
            className="flex-row items-center gap-[13px] bg-card px-4 py-3.5"
          >
            <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
              <LogOut size={18} className="text-destructive" />
            </View>
            <Text className="text-[15px] font-semibold text-destructive">
              {loggingOut ? "Signing out…" : "Sign out"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
