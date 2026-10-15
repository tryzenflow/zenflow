import { useLanguage } from "@/hooks/use-language";
import { locale, t } from "@/lib/i18n";
import { Bell, Plus, X } from "@/components/Icons";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { DurationSlider } from "@/components/ui/duration-slider";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import {
  REMINDER_UNITS,
  type ReminderUnitId,
  customReminderMinutes,
  reminderError,
  reminderLabel,
  reminderLeadLabel,
  upsertReminder,
} from "@zenflow/core";
import { MAX_REMINDERS_PER_SESSION } from "@zenflow/shared";
import { useState } from "react";
import { Pressable, View } from "react-native";

/** Quick lead times offered as chips. The rest of the range is Custom. */
const QUICK = [0, 15, 60, 1440] as const;

/** Largest amount per unit: up to seven days before, as the core rule allows. */
const MAX_AMOUNT: Record<ReminderUnitId, number> = {
  min: 59,
  hour: 23,
  day: 7,
  week: 1,
};

/** What the panel is open for: an existing reminder's minutes, or a new one. */
type Target = number | "add";

/**
 * Reminders as chips, plus one inline panel for adding or changing one. The
 * panel offers four quick lead times and a Custom amount (unit chips and a
 * slider), so no text input is needed. Values are minutes before start, kept
 * longest lead first, and no two may share a lead time.
 */
export function ReminderField({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
}) {
  useLanguage();
  const [target, setTarget] = useState<Target | null>(null);
  const [custom, setCustom] = useState(false);
  const [unit, setUnit] = useState<ReminderUnitId>("hour");
  const [amount, setAmount] = useState(1);
  const full = value.length >= MAX_REMINDERS_PER_SESSION;

  const current = target === null || target === "add" ? undefined : target;
  const others = value.filter((m) => m !== current);
  const unitMinutes = REMINDER_UNITS.find((u) => u.id === unit)!.minutes;
  const customMinutes = customReminderMinutes(String(amount), unitMinutes);
  const customError = reminderError(customMinutes, others);

  function openFor(next: Target) {
    setTarget(next);
    setCustom(false);
    setUnit("hour");
    setAmount(1);
  }

  function apply(minutes: number) {
    onChange(upsertReminder(value, minutes, current));
    setTarget(null);
  }

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center gap-2">
        {value.map((m) => (
          <View
            key={m}
            className={cn(
              "flex-row items-center rounded-full border border-primary/45 bg-primary/15",
              disabled && "opacity-50",
            )}
          >
            <Pressable
              disabled={disabled}
              onPress={() => openFor(m)}
              accessibilityLabel={t("Edit reminder: {reminder}", {
                reminder: localizedReminderLabel(m),
              })}
              className="h-11 flex-row items-center gap-2 pl-4 pr-2"
            >
              <Bell size={18} className="text-primary" />
              <Text className="text-[15px] font-semibold text-primary">
                {localizedReminderLabel(m)}
              </Text>
            </Pressable>
            <Pressable
              disabled={disabled}
              onPress={() => onChange(value.filter((x) => x !== m))}
              accessibilityLabel={t("Remove reminder: {reminder}", {
                reminder: localizedReminderLabel(m),
              })}
              hitSlop={8}
              className="mr-2 size-7 items-center justify-center rounded-full bg-primary/20"
            >
              <X size={13} className="text-primary" />
            </Pressable>
          </View>
        ))}
        {!full && target === null && (
          <Pressable
            testID="task.reminder.add"
            disabled={disabled}
            onPress={() => openFor("add")}
            className={cn(
              "h-11 flex-row items-center gap-2 rounded-full border border-dashed border-border px-4",
              disabled && "opacity-50",
            )}
          >
            <Plus size={18} className="text-muted-foreground" />
            <Text className="text-[15px] font-medium text-muted-foreground">
              {t("Add reminder")}
            </Text>
          </Pressable>
        )}
      </View>

      {target !== null && (
        <View
          testID="task.reminder.panel"
          className="gap-3 rounded-xl border border-border bg-muted/60 p-3"
        >
          <Text className="text-[13px] font-semibold text-foreground">
            {current === undefined
              ? t("How long before it starts?")
              : t("Change reminder")}
          </Text>
          {!custom ? (
            <ChipGroup<string>
              testID="task.reminder.quick"
              value={current === undefined ? null : String(current)}
              onChange={(v) => apply(Number(v))}
              onCustom={() => setCustom(true)}
              options={QUICK.filter((m) => !others.includes(m)).map((m) => ({
                value: String(m),
                label: localizedReminderLeadLabel(m),
              }))}
            />
          ) : (
            <View className="gap-3">
              <ChipGroup<ReminderUnitId>
                testID="task.reminder.unit"
                value={unit}
                onChange={(u) => {
                  setUnit(u);
                  setAmount(1);
                }}
                options={REMINDER_UNITS.map((u) => ({ value: u.id, label: u.id }))}
              />
              <DurationSlider
                testID="task.reminder.amount"
                label="Amount"
                value={amount}
                min={1}
                max={MAX_AMOUNT[unit]}
                step={1}
                valueLabel={(n) => `${n} ${t(unit)}`}
                onChange={setAmount}
              />
              {customError && (
                <Text className="text-[12.5px] font-medium text-destructive">
                  {t(customError)}
                </Text>
              )}
              <Button
                testID="task.reminder.save"
                className="w-full"
                disabled={customError !== null}
                onPress={() => apply(customMinutes)}
              >
                <Text className="font-semibold text-primary-foreground">
                  {current === undefined ? t("Add reminder") : t("Save")}
                </Text>
              </Button>
            </View>
          )}
          <Pressable
            onPress={() => setTarget(null)}
            className="min-h-[44px] items-center justify-center"
          >
            <Text className="text-[13px] font-medium text-muted-foreground">
              {t("Cancel")}
            </Text>
          </Pressable>
        </View>
      )}

      {full && (
        <Text className="text-[12.5px] leading-snug text-muted-foreground">
          {t("{count} of {max} reminders set. Tap one to change it.", {
            count: value.length,
            max: MAX_REMINDERS_PER_SESSION,
          })}
        </Text>
      )}
    </View>
  );
}

/** Lead time in the app's language: "At start", "15 min", "2 hours". */
export function localizedReminderLeadLabel(minutes: number): string {
  if (locale() !== "vi-VN") return reminderLeadLabel(minutes);
  if (minutes === 0) return t("At start");
  const unit =
    minutes % 10080 === 0
      ? 10080
      : minutes % 1440 === 0
        ? 1440
        : minutes % 60 === 0
          ? 60
          : 1;
  const word =
    unit === 10080 ? "week" : unit === 1440 ? "day" : unit === 60 ? "hour" : "min";
  return `${minutes / unit} ${t(word)}`;
}

/** Chip text: "At start time", "1 hour before" (VI: "Trước 1 giờ"). */
export function localizedReminderLabel(minutes: number): string {
  if (locale() !== "vi-VN") return reminderLabel(minutes);
  return minutes === 0
    ? t("At start time")
    : t("Before {lead}", { lead: localizedReminderLeadLabel(minutes) });
}
