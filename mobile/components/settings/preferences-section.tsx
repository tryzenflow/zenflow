import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import {
  AlarmClockIcon,
  Bell,
  ChevronRight,
  Clock,
  Globe,
} from "@/components/Icons";
import {
  OptionSheet,
  type OptionSheetHandle,
} from "@/components/settings/option-sheet";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { useNotificationToggle } from "@/hooks/use-notification-toggle";
import { Switch } from "@/components/ui/switch";
import { haptic } from "@/lib/haptics";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import {
  LANGUAGES,
  REMINDERS,
  allTimezones,
  deviceTimezone,
  usePreferences,
} from "@/lib/preferences";
import { filterTimezones, gmtOffset } from "@/lib/onboarding";
import { timezonePickerValue } from "@/lib/preferences-sync";
import { type ComponentType, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";

function Row({
  Icon,
  title,
  value,
  onPress,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  value: string;
  onPress: () => void;
}) {
  useLanguage();
  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${value}`}
      className="min-h-14 flex-row items-center gap-[13px] px-4 py-3.5"
    >
      <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
        <Icon size={18} className="text-foreground" />
      </View>
      <Text className="flex-1 text-[15px] font-semibold">{title}</Text>
      <Text className="text-[13px] text-muted-foreground">{value}</Text>
      <ChevronRight size={18} className="text-muted-foreground" />
    </Pressable>
  );
}

/** Preferences + Notifications sections (mockups/settings.html). */
const TZ_RESULT_LIMIT = 50;

export function PreferencesSection() {
  useLanguage();
  const { prefs, update } = usePreferences();
  const { setEnabled, active } = useNotificationToggle();
  const { toast } = useToast();
  const languageSheet = useRef<OptionSheetHandle>(null);
  const timezoneSheet = useRef<OptionSheetHandle>(null);
  const reminderSheet = useRef<OptionSheetHandle>(null);

  const device = deviceTimezone();
  // Searchable, nearest-to-device-first (same ordering as onboarding). With no
  // query the pinned "Device" row leads; the full list is capped, with a
  // "refine your search" hint for the rest.
  const tzSearch = useMemo(
    () => ({
      placeholder: t("Search all timezones"),
      results: (query: string) => {
        const hits = filterTimezones(allTimezones(), query, Infinity, device);
        const options = hits
          .slice(0, TZ_RESULT_LIMIT)
          .map((z) => ({ value: z, label: z, detail: gmtOffset(z) }));
        if (query.trim()) return { options, total: hits.length };
        return {
          options: [
            {
              value: "device",
              label: t("Device ({zone})", { zone: device }),
              detail: gmtOffset(device),
            },
            ...options,
          ],
          total: hits.length + 1,
        };
      },
    }),
    [device, prefs.language],
  );
  const tzLabel = prefs.timezoneMode === "device" ? device : prefs.timezone;

  async function save(patch: Parameters<typeof update>[0]) {
    if (!(await update(patch))) {
      toast({
        title: t("Couldn't save preference"),
        description: t("Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function toggleNotifications(on: boolean) {
    await setEnabled(on);
  }

  return (
    <>
      <SettingsSectionLabel>{t("Preferences")}</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <Row
          Icon={Globe}
          title={t("Language")}
          value={(() => {
            const l = LANGUAGES.find((l) => l.value === prefs.language);
            return l ? `${l.flag} ${l.label}` : "";
          })()}
          onPress={() => languageSheet.current?.open()}
        />
        <View className="h-px bg-border" />
        <Row
          Icon={Clock}
          title={t("Timezone")}
          value={tzLabel}
          onPress={() => timezoneSheet.current?.open()}
        />
        <View className="h-px bg-border" />
        <Row
          Icon={AlarmClockIcon}
          title={t("Default reminder")}
          value={
            REMINDERS.find((r) => r.value === prefs.defaultReminder)?.label ??
            ""
          }
          onPress={() => reminderSheet.current?.open()}
        />
      </View>

      <SettingsSectionLabel>{t("Notifications")}</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <View className="flex-row items-center gap-[13px] px-4 py-3.5">
          <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <Bell size={18} className="text-foreground" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold">
              {t("Allow notifications")}
            </Text>
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              {t("Push alerts for reminders and schedule changes")}
            </Text>
          </View>
          <Switch
            checked={active}
            onCheckedChange={toggleNotifications}
            accessibilityLabel={t("Allow notifications")}
          />
        </View>
      </View>

      <OptionSheet
        ref={languageSheet}
        title={t("Language")}
        options={LANGUAGES}
        value={prefs.language}
        onSelect={(language) => save({ language })}
      />
      <OptionSheet
        ref={timezoneSheet}
        title={t("Timezone")}
        options={[]}
        search={tzSearch}
        value={timezonePickerValue(prefs)}
        onSelect={(timezone) => save({ timezone })}
      />
      <OptionSheet
        ref={reminderSheet}
        title={t("Default reminder")}
        options={REMINDERS}
        value={prefs.defaultReminder}
        onSelect={(defaultReminder) => save({ defaultReminder })}
      />
    </>
  );
}
