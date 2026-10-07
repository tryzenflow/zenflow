import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { logout as logoutRequest } from "@/api/auth";
import { listIntegrations } from "@/api/integrations";
import { LogOut, Moon } from "@/components/Icons";
import { DluAccountsSection } from "@/components/settings/dlu-accounts-section";
import { FinishSetupCard } from "@/components/settings/finish-setup-card";
import { TagsRow } from "@/components/settings/tags-row";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useNotificationToggle } from "@/hooks/use-notification-toggle";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { ProfileRow } from "@/components/settings/profile-row";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useUserStore } from "@/hooks/use-user-store";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { clearSession } from "@/lib/api-client";
import { clearCachedSessionUser } from "@/lib/session";
import { clearDaySessionCache } from "@/lib/session-cache";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { resetTimelineScroll } from "@/lib/timeline-scroll";
import { useColorScheme } from "@/lib/useColorScheme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type Href, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Single flat Settings screen — mirrors mockups/settings.html exactly. */
export default function SettingsScreen() {
  useLanguage();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);
  const { setIntegrations, setLoading } = useIntegrationStore();
  const { isDarkColorScheme, setColorScheme } = useColorScheme();
  const [loggingOut, setLoggingOut] = useState(false);
  const scrollRef = useRef<{
    scrollTo: (o: { y: number; animated: boolean }) => void;
  }>(null);
  const dluY = useRef(0);
  const notif = useNotificationToggle();
  const integrations = useIntegrationStore((s) => s.integrations);
  const integrationsLoading = useIntegrationStore((s) => s.loading);
  const dluConnected = integrations.some((i) => i.connected);

  useEffect(() => {
    let mounted = true;
    listIntegrations()
      .then((integrations) => {
        if (mounted) setIntegrations(integrations);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [setIntegrations, setLoading]);

  function toggleDarkMode() {
    const next = isDarkColorScheme ? "light" : "dark";
    setColorScheme(next);
    setAndroidNavigationBar(next);
    AsyncStorage.setItem("theme", next);
  }

  async function handleSignOut() {
    setLoggingOut(true);
    // Drop this device from push while the session cookie is still valid;
    // allowNotifications is kept so the next login prompts again.
    await usePushStatusStore.getState().unregisterOnLogout();
    try {
      await logoutRequest();
    } catch {
      // Best-effort — clear the local session regardless of API result.
    }
    await clearSession();
    await clearCachedSessionUser();
    // Drop the calendar's in-memory day cache + shared scroll anchor so the
    // next user never sees a flash of the previous account's days.
    clearDaySessionCache();
    resetTimelineScroll();
    setUser(null);
    setLoggingOut(false);
    router.replace("/(auth)/login" as Href);
  }

  const tabBarOverlay = useTabBarOverlayHeight();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background">
      <View
        className="border-b border-border bg-background px-6 pb-4"
        style={{ paddingTop: insets.top + 16 }}
      >
        <Text className="text-xl font-bold tracking-tight">
          {t("Settings")}
        </Text>
      </View>
      <ScrollView
        ref={scrollRef as never}
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: tabBarOverlay + 32 }}
      >
        {notif.ready && !integrationsLoading && (
          <FinishSetupCard
            notificationsActive={notif.active}
            dluConnected={dluConnected}
            onPress={(item) => {
              if (item === "notifications") void notif.setEnabled(true);
              else
                scrollRef.current?.scrollTo({
                  y: dluY.current,
                  animated: true,
                });
            }}
          />
        )}

        <SettingsSectionLabel>{t("Profile")}</SettingsSectionLabel>
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          {user ? (
            <ProfileRow user={user} onUpdated={setUser} />
          ) : (
            <View className="flex-row items-center gap-[13px] px-4 py-3.5">
              <Skeleton className="size-12 rounded-full" />
              <View className="flex-1 gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </View>
            </View>
          )}
        </View>

        <SettingsSectionLabel>{t("Appearance")}</SettingsSectionLabel>
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          <View className="flex-row items-center gap-[13px] bg-card px-4 py-3.5">
            <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
              <Moon size={18} className="text-foreground" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-semibold">
                {t("Dark mode")}
              </Text>
              <Text className="mt-0.5 text-[13px] text-muted-foreground">
                {t("Follow the warm-sunrise night palette")}
              </Text>
            </View>
            <Switch
              checked={isDarkColorScheme}
              onCheckedChange={toggleDarkMode}
            />
          </View>
        </View>

        <PreferencesSection />

        <TagsRow />

        <View
          onLayout={(e) => {
            dluY.current = e.nativeEvent.layout.y;
          }}
        >
          <DluAccountsSection />
        </View>

        <SettingsSectionLabel>{t("Account")}</SettingsSectionLabel>
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
              {loggingOut ? t("Signing out…") : t("Sign out")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
