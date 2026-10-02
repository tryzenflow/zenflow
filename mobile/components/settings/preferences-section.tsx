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
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import {
  LANGUAGES,
  REMINDERS,
  TIMEZONES,
  deviceTimezone,
  usePreferences,
} from "@/lib/preferences";
import { dropPushRegistration, syncPushRegistration } from "@/lib/push";
import { type ComponentType, useRef } from "react";
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
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-[13px] px-4 py-3.5"
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
export function PreferencesSection() {
  const { prefs, update } = usePreferences();
  const { toast } = useToast();
  const languageSheet = useRef<OptionSheetHandle>(null);
  const timezoneSheet = useRef<OptionSheetHandle>(null);
  const reminderSheet = useRef<OptionSheetHandle>(null);

  const device = deviceTimezone();
  const tzOptions = [
    { value: "device", label: `Device (${device})` },
    ...TIMEZONES.map((z) => ({ value: z, label: z })),
  ];
  const tzLabel = prefs.timezone === "device" ? device : prefs.timezone;

  async function toggleNotifications(on: boolean) {
    await update({ notificationsEnabled: on });
    if (on) {
      // Re-registers this device (also asks for OS permission if needed).
      const token = await syncPushRegistration();
      if (!token) toast("Couldn't enable push on this device.", "destructive");
    } else {
      // Revoke this device server-side so it stops receiving pushes.
      await dropPushRegistration();
    }
  }

  return (
    <>
      <SettingsSectionLabel>Preferences</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <Row
          Icon={Globe}
          title="Language"
          value={LANGUAGES.find((l) => l.value === prefs.language)?.label ?? ""}
          onPress={() => languageSheet.current?.open()}
        />
        <View className="h-px bg-border" />
        <Row
          Icon={Clock}
          title="Timezone"
          value={tzLabel}
          onPress={() => timezoneSheet.current?.open()}
        />
        <View className="h-px bg-border" />
        <Row
          Icon={AlarmClockIcon}
          title="Default reminder"
          value={
            REMINDERS.find((r) => r.value === prefs.defaultReminder)?.label ??
            ""
          }
          onPress={() => reminderSheet.current?.open()}
        />
      </View>

      <SettingsSectionLabel>Notifications</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <View className="flex-row items-center gap-[13px] px-4 py-3.5">
          <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <Bell size={18} className="text-foreground" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold">
              Allow notifications
            </Text>
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              Push alerts for reminders and schedule changes
            </Text>
          </View>
          <Switch
            checked={prefs.notificationsEnabled}
            onCheckedChange={toggleNotifications}
          />
        </View>
      </View>

      <OptionSheet
        ref={languageSheet}
        title="Language"
        options={LANGUAGES}
        value={prefs.language}
        onSelect={(language) => update({ language })}
      />
      <OptionSheet
        ref={timezoneSheet}
        title="Timezone"
        options={tzOptions}
        value={prefs.timezone}
        onSelect={(timezone) => update({ timezone })}
      />
      <OptionSheet
        ref={reminderSheet}
        title="Default reminder"
        options={REMINDERS}
        value={prefs.defaultReminder}
        onSelect={(defaultReminder) => update({ defaultReminder })}
      />
    </>
  );
}
