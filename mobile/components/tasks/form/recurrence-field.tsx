import { useLanguage } from "@/hooks/use-language";
import { t, locale } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  type RecurrenceFreq as Freq,
  type RecurrenceState,
  fromRrule,
  toRrule,
} from "@zenflow/core";
import { format } from "date-fns";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { InlineDateField } from "./inline-date-field";

const WEEKDAYS: { key: string; label: string }[] = [
  { key: "MO", label: "M" },
  { key: "TU", label: "T" },
  { key: "WE", label: "W" },
  { key: "TH", label: "T" },
  { key: "FR", label: "F" },
  { key: "SA", label: "S" },
  { key: "SU", label: "S" },
];

/**
 * Recurrence builder for the fixed session types (DND / assignment / exam /
 * lecture) — a constrained subset of RFC 5545: None / Daily / Weekly, an
 * optional weekday set (Weekly only), and an optional end date. Emits the
 * form's `rrule` string field (or `undefined` for a one-off).
 */
export function RecurrenceField({
  value,
  onChange,
  tz,
  disabled,
}: {
  value: string | undefined;
  onChange: (rrule: string | undefined) => void;
  tz: string;
  disabled?: boolean;
}) {
  useLanguage();
  const state = useMemo(() => fromRrule(value), [value]);

  const set = (next: Partial<RecurrenceState>) =>
    onChange(toRrule({ ...state, ...next }));

  return (
    <View className="gap-3">
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Repeat")}
        className="flex-row gap-2"
      >
        {(["NONE", "DAILY", "WEEKLY"] as Freq[]).map((f) => {
          const active = state.freq === f;
          return (
            <Pressable
              key={f}
              disabled={disabled}
              onPress={() => {
                if (!active) haptic.select();
                set({ freq: f });
              }}
              accessibilityRole="radio"
              accessibilityLabel={freqLabel(f)}
              accessibilityState={{ selected: active, disabled: !!disabled }}
              className={cn(
                "min-h-11 flex-1 items-center justify-center rounded-lg border px-2 py-2",
                active
                  ? "border-primary bg-primary"
                  : "border-input bg-card",
                disabled && "opacity-50",
              )}
            >
              <Text
                className={cn(
                  "text-xs font-semibold",
                  active
                    ? "text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                {freqLabel(f)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {state.freq === "WEEKLY" && (
        <View
          accessibilityLabel={t("Repeat on")}
          className="flex-row justify-between"
        >
          {WEEKDAYS.map((d, i) => {
            const active = state.byday.includes(d.key);
            return (
              <Pressable
                key={`${d.key}-${i}`}
                disabled={disabled}
                onPress={() => {
                  haptic.select();
                  set({
                    byday: active
                      ? state.byday.filter((x) => x !== d.key)
                      : [...state.byday, d.key],
                  });
                }}
                accessibilityRole="checkbox"
                accessibilityLabel={weekdayName(i)}
                accessibilityState={{ checked: active, disabled: !!disabled }}
                className={cn(
                  "size-11 items-center justify-center rounded-full border",
                  active
                    ? "border-primary bg-primary"
                    : "border-input bg-card",
                  disabled && "opacity-50",
                )}
              >
                <Text
                  className={cn(
                    "text-xs font-semibold",
                    active
                      ? "text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {locale() === "vi-VN"
                    ? ["T2", "T3", "T4", "T5", "T6", "T7", "CN"][i]
                    : d.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {state.freq !== "NONE" && (
        <View>
          <Text className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("Ends on (optional)")}
          </Text>
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <InlineDateField
                value={
                  state.until ? new Date(`${state.until}T00:00:00`) : undefined
                }
                onChange={(d) => set({ until: format(d, "yyyy-MM-dd") })}
                tz={tz}
                disabled={disabled}
              />
            </View>
            {!!state.until && (
              <Pressable
                disabled={disabled}
                onPress={() => set({ until: undefined })}
                accessibilityRole="button"
                accessibilityLabel={t("Clear end date")}
                className={cn(
                  "h-[46px] items-center justify-center rounded-xl border border-input bg-card px-3",
                  disabled && "opacity-50",
                )}
              >
                <Text className="text-[13px] font-medium text-muted-foreground">
                  {t("Clear")}
                </Text>
              </Pressable>
            )}
          </View>
          <Text className="mt-1.5 text-label text-muted-foreground">
            {state.until
              ? t("Repeats until this date.")
              : t("Repeats indefinitely.")}
          </Text>
        </View>
      )}
    </View>
  );
}

function freqLabel(f: Freq): string {
  return f === "NONE" ? t("Once") : f === "DAILY" ? t("Daily") : t("Weekly");
}

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Full weekday name for the screen reader; the pill itself only shows "T2" or "M". */
function weekdayName(i: number): string {
  return t(WEEKDAY_NAMES[i]);
}
