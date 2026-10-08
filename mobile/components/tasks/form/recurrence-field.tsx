import { useLanguage } from "@/hooks/use-language";
import { t, locale } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
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
      <View className="flex-row gap-1.5">
        {(["NONE", "DAILY", "WEEKLY"] as Freq[]).map((f) => {
          const active = state.freq === f;
          return (
            <Pressable
              key={f}
              disabled={disabled}
              onPress={() => set({ freq: f })}
              className={cn(
                "flex-1 items-center rounded-lg border px-2 py-2",
                active
                  ? "border-primary bg-primary/10"
                  : "border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
                disabled && "opacity-50",
              )}
            >
              <Text
                className={cn(
                  "text-[12px] font-semibold",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {f === "NONE"
                  ? t("Once")
                  : f === "DAILY"
                    ? t("Daily")
                    : t("Weekly")}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {state.freq === "WEEKLY" && (
        <View className="flex-row justify-between">
          {WEEKDAYS.map((d, i) => {
            const active = state.byday.includes(d.key);
            return (
              <Pressable
                key={`${d.key}-${i}`}
                disabled={disabled}
                onPress={() =>
                  set({
                    byday: active
                      ? state.byday.filter((x) => x !== d.key)
                      : [...state.byday, d.key],
                  })
                }
                className={cn(
                  "h-9 w-9 items-center justify-center rounded-full border",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07]",
                  disabled && "opacity-50",
                )}
              >
                <Text
                  className={cn(
                    "text-[12px] font-semibold",
                    active ? "text-primary" : "text-muted-foreground",
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
          <Text className="mb-1.5 text-[12px] font-medium text-muted-foreground">
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
                accessibilityLabel={t("Clear end date")}
                className={cn(
                  "h-[46px] items-center justify-center rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07] px-3",
                  disabled && "opacity-50",
                )}
              >
                <Text className="text-[13px] font-medium text-muted-foreground">
                  {t("Clear")}
                </Text>
              </Pressable>
            )}
          </View>
          <Text className="mt-1.5 text-[11px] text-muted-foreground">
            {state.until
              ? t("Repeats until this date.")
              : t("Repeats indefinitely.")}
          </Text>
        </View>
      )}
    </View>
  );
}
