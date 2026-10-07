import { useLanguage } from "@/hooks/use-language";
import { t, locale } from "@/lib/i18n";
import { Bell, Plus, X } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetTextInput,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import {
  REMINDER_PRESETS,
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

/** What the sheet is open for: an existing reminder (its minutes) or a new one. */
type Target = number | "add";

/**
 * Reminder chips + a bottom sheet of presets (At start · 15 min · … · 1 week)
 * and a custom amount/unit. Tap a chip to change it in place, its × to remove
 * it, "Add reminder" for a new one. Values are minutes before start, kept
 * sorted longest-lead first; no two reminders may share a lead time (that
 * preset is disabled, a custom duplicate shows an error).
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
  const sheet = useBottomSheet();
  const [target, setTarget] = useState<Target>("add");
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState<ReminderUnitId>("hour");
  const full = value.length >= MAX_REMINDERS_PER_SESSION;

  const current = target === "add" ? undefined : target;
  const others = value.filter((m) => m !== current);

  const unitMinutes = REMINDER_UNITS.find((u) => u.id === unit)!.minutes;
  const customMinutes = customReminderMinutes(custom, unitMinutes);
  const customError =
    custom === "" ? null : reminderError(customMinutes, others);

  function openFor(next: Target) {
    setTarget(next);
    setCustom("");
    sheet.open();
  }

  function pick(minutes: number) {
    onChange(upsertReminder(value, minutes, current));
    sheet.close();
  }

  return (
    <View className="gap-1.5">
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
              className="flex-row items-center gap-1.5 py-1.5 pl-3 pr-1.5"
            >
              <Bell size={14} className="text-primary-text" />
              <Text className="text-[13px] font-medium text-primary-text">
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
              className="mr-1.5 size-4 items-center justify-center rounded-full bg-primary/20"
            >
              <X size={10} className="text-primary-text" />
            </Pressable>
          </View>
        ))}
        {!full && (
          <Pressable
            disabled={disabled}
            onPress={() => openFor("add")}
            className={cn(
              "flex-row items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5",
              disabled && "opacity-50",
            )}
          >
            <Plus size={14} className="text-muted-foreground" />
            <Text className="text-[13px] font-medium text-muted-foreground">
              {t("Add reminder")}
            </Text>
          </Pressable>
        )}
      </View>
      <Text className="text-[12.5px] leading-snug text-muted-foreground">
        {full
          ? t("{count} of {max} reminders set — tap one to change it.", {
              count: value.length,
              max: MAX_REMINDERS_PER_SESSION,
            })
          : t(
              "New tasks use your default reminder from Settings. Tap a reminder to change it. Up to {max} per task.",
              { max: MAX_REMINDERS_PER_SESSION },
            )}
      </Text>

      <BottomSheet>
        <BottomSheetContent ref={sheet.ref}>
          {/* gorhom sizes a dynamic sheet by measuring a BottomSheetView —
              plain Views here left it at height 0 on native. */}
          <BottomSheetView hadHeader={false} className="px-5">
            <View>
              <Text className="text-[19px] font-bold tracking-tight">
                {current === undefined
                  ? t("Add reminder")
                  : t("Change reminder")}
              </Text>
              <Text className="mt-0.5 text-[13px] text-muted-foreground">
                {t("How long before it starts?")}
              </Text>
            </View>

            <View className="mt-4 flex-row flex-wrap gap-2">
              {REMINDER_PRESETS.map((m) => {
                const taken = others.includes(m);
                return (
                  <Pressable
                    key={m}
                    disabled={taken}
                    onPress={() => pick(m)}
                    className={cn(
                      "h-10 min-w-[30%] flex-1 items-center justify-center rounded-xl border border-border bg-muted px-3",
                      m === current && "border-primary/50 bg-primary/15",
                      taken && "opacity-40",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-[13px] font-semibold text-muted-foreground",
                        m === current && "text-primary-text",
                      )}
                    >
                      {localizedReminderLeadLabel(m)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="mt-4 flex-row items-center gap-2">
              <View className="h-px flex-1 bg-border" />
              <Text className="text-[11px] text-muted-foreground">
                {t("or custom")}
              </Text>
              <View className="h-px flex-1 bg-border" />
            </View>

            <View className="mt-3 flex-row h-10 items-center gap-2">
              <BottomSheetTextInput
                value={custom}
                onChangeText={setCustom}
                keyboardType="number-pad"
                placeholder={t("e.g. 2")}
                accessibilityLabel={t("Custom reminder amount")}
                className="h-12 w-28 px-3 text-[13px]"
              />
              <View className="flex-1 flex-row h-full gap-1">
                {REMINDER_UNITS.map((u) => (
                  <Pressable
                    key={t(u.id)}
                    onPress={() => setUnit(u.id)}
                    className={cn(
                      "flex-1 items-center justify-center rounded-lg border border-border bg-muted",
                      u.id === unit && "border-primary/50 bg-primary/15",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-[12px] font-semibold text-muted-foreground",
                        u.id === unit && "text-primary-text",
                      )}
                    >
                      {t(u.id)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {!!customError && (
              <Text className="mt-1.5 text-[12px] font-medium text-destructive">
                {t(customError)}
              </Text>
            )}

            <View className="pt-4">
              <Button
                className="w-full"
                disabled={custom === "" || customError !== null}
                onPress={() => pick(customMinutes)}
              >
                <Text className="font-semibold text-primary-foreground">
                  {current === undefined ? t("Add custom reminder") : t("Save")}
                </Text>
              </Button>
            </View>
          </BottomSheetView>
        </BottomSheetContent>
      </BottomSheet>
    </View>
  );
}

function localizedReminderLeadLabel(minutes: number): string {
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
  return (
    minutes / unit +
    " " +
    t(
      unit === 10080
        ? "week"
        : unit === 1440
          ? "day"
          : unit === 60
            ? "hour"
            : "min",
    )
  );
}
function localizedReminderLabel(minutes: number): string {
  if (locale() !== "vi-VN") return reminderLabel(minutes);
  return minutes === 0
    ? t("At start time")
    : "Trước " + localizedReminderLeadLabel(minutes);
}
