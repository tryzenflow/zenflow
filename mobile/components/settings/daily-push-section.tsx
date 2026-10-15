import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import type { DailyPushKind, DailyPushSettings } from "@zenflow/shared";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { getDailyPush, updateDailyPush } from "@/api/daily-push";
import { useToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import {
  DEFAULT_DAILY_TIMES,
  dateToTime,
  timeToDate,
} from "@/lib/daily-push";
import { t } from "@/lib/i18n";

type Row = {
  kind: DailyPushKind;
  field: keyof DailyPushSettings;
  title: string;
  body: string;
};

const ROWS: Row[] = [
  {
    kind: "morning",
    field: "morningBriefTime",
    title: "Morning brief",
    body: "Today's classes and study blocks.",
  },
  {
    kind: "evening",
    field: "eveningCheckinTime",
    title: "Evening check-in",
    body: "Mark today's sessions done or missed.",
  },
];

/**
 * Morning brief and evening check-in times (issue #255). Both are off until
 * switched on. Times are read on the account's timezone.
 */
export function DailyPushSection() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<DailyPushSettings | null>(null);
  const [picking, setPicking] = useState<DailyPushKind | null>(null);

  useEffect(() => {
    getDailyPush()
      .then(setSettings)
      .catch(() => {});
  }, []);

  async function save(next: DailyPushSettings) {
    const prev = settings;
    setSettings(next);
    try {
      setSettings(await updateDailyPush(next));
    } catch {
      setSettings(prev);
      toast({
        title: t("Could not save. Try again."),
        variant: "destructive",
      });
    }
  }

  if (!settings) return null;

  return (
    <View className="mb-[18px] overflow-hidden rounded-2xl border border-border bg-card">
      {ROWS.map(({ kind, field, title, body }, index) => {
        const time = settings[field];
        return (
          <View key={kind}>
            <View
              className={`flex-row items-center gap-[13px] bg-card px-4 py-3.5 ${index > 0 ? "border-t border-border" : ""}`}
            >
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold">{t(title)}</Text>
                <Text className="mt-0.5 text-[13px] text-muted-foreground">
                  {t(body)}
                </Text>
                <Text className="mt-0.5 text-[12px] text-muted-foreground">
                  {t("Skipped on do-not-disturb days.")}
                </Text>
              </View>
              {time ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPicking(kind)}
                  className="px-1"
                >
                  <Text className="text-[15px] font-semibold tabular-nums">
                    {time}
                  </Text>
                </Pressable>
              ) : null}
              <Switch
                checked={time !== null}
                onCheckedChange={(on) =>
                  void save({
                    ...settings,
                    [field]: on ? DEFAULT_DAILY_TIMES[kind] : null,
                  })
                }
              />
            </View>
            {picking === kind && time ? (
              <DateTimePicker
                value={timeToDate(time)}
                mode="time"
                display="default"
                is24Hour
                onChange={(event: DateTimePickerEvent, selected?: Date) => {
                  setPicking(null);
                  if (event.type === "set" && selected) {
                    void save({ ...settings, [field]: dateToTime(selected) });
                  }
                }}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
