import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { logout as logoutRequest } from "@/api/auth";
import { listIntegrations } from "@/api/integrations";
import { LogOut, Moon } from "@/components/Icons";
import { DailyPushSection } from "@/components/settings/daily-push-section";
import { DluAccountsSection } from "@/components/settings/dlu-accounts-section";
import { FinishSetupCard } from "@/components/settings/finish-setup-card";
import { TagsRow } from "@/components/settings/tags-row";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useNotificationState } from "@/hooks/use-notification-toggle";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { ProfileRow } from "@/components/settings/profile-row";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { AdvancedSection } from "@/components/settings/advanced-section";
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
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import {
  loadIntegrationCache,
  saveIntegrationCache,
} from "@/lib/integration-cache";
import { OfflineIndicator } from "@/components/offline-indicator";
import { OfflineLock } from "@/components/offline-lock";
import { useOffline } from "@/hooks/use-offline";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The Me tab: profile, preferences, daily plan, DLU and account. Advanced holds timezone and storage. */
export default function SettingsScreen() {
  const offline = useOffline();
  useLanguage();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);
  const setIntegrations = useIntegrationStore((s) => s.setIntegrations);
  const setLoading = useIntegrationStore((s) => s.setLoading);
  const { isDarkColorScheme, setColorScheme } = useColorScheme();
  const [loggingOut, setLoggingOut] = useState(false);
  const scrollRef = useRef<{
    scrollTo: (o: { y: number; animated: boolean }) => void;
  }>(null);
  const dluY = useRef(0);
  // `?focus=dlu` (the calendar's "Import my timetable") lands on the LMS and portal section.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const notif = useNotificationState();
  const integrations = useIntegrationStore((s) => s.integrations);
  const integrationsLoading = useIntegrationStore((s) => s.loading);
  const dluConnected = integrations.some((i) => i.connected);

  // Settings stays mounted between visits, so the layout scroll below only covers the first one.
  useEffect(() => {
    if (focus !== "dlu" || dluY.current === 0) return;
    scrollRef.current?.scrollTo({ y: dluY.current, animated: true });
  }, [focus]);

  useEffect(() => {
    let mounted = true;
    const userId = user?.id;
    listIntegrations()
      .then((integrations) => {
        if (mounted) setIntegrations(integrations);
        if (userId) void saveIntegrationCache(userId, integrations);
      })
      .catch(async () => {
        // Offline: show the last status we saw instead of "Not connected".
        const saved = userId ? await loadIntegrationCache(userId) : null;
        if (mounted && saved) setIntegrations(saved);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [setIntegrations, setLoading, user?.id]);

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
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold tracking-tight">
            {t("Me")}
          </Text>
          <OfflineIndicator dayKey="settings" />
        </View>
      </View>
      <ScrollView
        ref={scrollRef as never}
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: tabBarOverlay + 32 }}
      >
        {notif.ready && !integrationsLoading && !offline && (
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
                {t("Easy on the eyes at night")}
              </Text>
            </View>
            <Switch
              checked={isDarkColorScheme}
              onCheckedChange={toggleDarkMode}
            />
          </View>
        </View>

        <PreferencesSection />
        <SettingsSectionLabel>{t("Daily plan")}</SettingsSectionLabel>
        <OfflineLock>
          <DailyPushSection />
        </OfflineLock>
        <OfflineLock>
          <TagsRow />
        </OfflineLock>

        <View
          onLayout={(e) => {
            dluY.current = e.nativeEvent.layout.y;
            if (focus === "dlu") {
              scrollRef.current?.scrollTo({ y: dluY.current, animated: true });
            }
          }}
        >
          <OfflineLock>
            <DluAccountsSection />
          </OfflineLock>
        </View>

        <AdvancedSection />

        <SettingsSectionLabel>{t("Account")}</SettingsSectionLabel>
        <View className="mb-[18px] overflow-hidden rounded-2xl border border-border bg-card">
          <Pressable
            testID="settings.sign-out"
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
