import { useState } from "react";
import { isAxiosError } from "axios";
import { Href, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, ScrollView, View } from "react-native";
import type { DurationAdjustmentMode } from "@zenflow/shared";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { ProfileRow } from "@/components/settings/profile-row";
import { TimezonePickerRow } from "@/components/settings/timezone-picker-row";
import { DurationModePickerRow } from "@/components/settings/duration-mode-picker-row";
import { InsightsPanel } from "@/components/settings/insights-panel";
import { TimePickerRow } from "@/components/onboarding/time-picker-row";
import { WorkDaysGrid } from "@/components/onboarding/work-days-grid";
import { LogOut, Moon } from "@/components/Icons";
import { useUserStore } from "@/hooks/use-user-store";
import { useColorScheme } from "@/lib/useColorScheme";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { updatePreferences } from "@/api/users";
import { logout as logoutRequest } from "@/api/auth";
import { clearSession } from "@/lib/api-client";
import { clearCachedSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { minutesToLabel } from "@/utils/preferences";

type PreferencesPatch = Partial<{
  workStart: number;
  workEnd: number;
  workDays: number[];
  timezone: string;
  durationAdjustmentMode: DurationAdjustmentMode;
}>;

/** Single flat Settings screen — mirrors mockups/settings.html exactly. */
export default function SettingsScreen() {
  const { toast } = useToast();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);
  const { isDarkColorScheme, setColorScheme } = useColorScheme();
  const [loggingOut, setLoggingOut] = useState(false);

  async function savePreferences(
    patch: PreferencesPatch,
    successMessage: string,
  ) {
    if (!user) return;
    try {
      const updated = await updatePreferences({
        workStart: patch.workStart ?? user.workStart,
        workEnd: patch.workEnd ?? user.workEnd,
        workDays: patch.workDays ?? user.workDays,
        timezone: patch.timezone ?? user.timezone,
        durationAdjustmentMode:
          patch.durationAdjustmentMode ?? user.durationAdjustmentMode,
      });
      setUser(updated);
      toast(successMessage, "success");
    } catch (error) {
      const message =
        (isAxiosError(error) && error.response?.data?.message) ||
        "Failed to save preferences";
      toast(message, "destructive");
    }
  }

  function toggleDay(iso: number) {
    if (!user) return;
    const next = user.workDays.includes(iso)
      ? user.workDays.filter((x) => x !== iso)
      : [...user.workDays, iso].sort();
    if (next.length === 0) return;
    savePreferences({ workDays: next }, "Work days updated");
  }

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

  if (!user) return null;

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border bg-background px-4 pb-3.5 pt-1.5">
        <Text className="text-xl font-bold tracking-tight">Settings</Text>
      </View>
      <ScrollView className="flex-1 px-5" contentContainerClassName="pb-8">
        <SettingsSectionLabel>Profile</SettingsSectionLabel>
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          <ProfileRow user={user} onUpdated={setUser} />
        </View>

        <SettingsSectionLabel>Working hours</SettingsSectionLabel>
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          <TimePickerRow
            label="Start"
            sheetTitle="Work starts at"
            value={user.workStart}
            onChange={(v) =>
              savePreferences(
                { workStart: v },
                `Work hours updated — starts at ${minutesToLabel(v)}`,
              )
            }
          />
          <TimePickerRow
            label="End"
            sheetTitle="Work ends at"
            value={user.workEnd}
            onChange={(v) =>
              savePreferences(
                { workEnd: v },
                `Work hours updated — ends at ${minutesToLabel(v)}`,
              )
            }
            className="border-t border-border"
          />
        </View>

        <SettingsSectionLabel>Work days</SettingsSectionLabel>
        <View className="rounded-2xl border border-border bg-card p-4">
          <WorkDaysGrid value={user.workDays} onToggle={toggleDay} />
          <Text className="mt-[7px] text-[13px] leading-snug text-muted-foreground">
            Tasks only auto-schedule on selected days.
          </Text>
        </View>

        <SettingsSectionLabel>Timezone</SettingsSectionLabel>
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          <TimezonePickerRow
            value={user.timezone}
            onChange={(tz) =>
              savePreferences({ timezone: tz }, `Timezone set to ${tz}`)
            }
          />
        </View>

        <SettingsSectionLabel>Scheduling</SettingsSectionLabel>
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          <DurationModePickerRow
            value={user.durationAdjustmentMode}
            onChange={(mode) =>
              savePreferences(
                { durationAdjustmentMode: mode },
                "Scheduling preferences saved",
              )
            }
          />
        </View>

        <SettingsSectionLabel>Insights</SettingsSectionLabel>
        <View className="rounded-2xl border border-border bg-card p-4">
          <InsightsPanel />
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
