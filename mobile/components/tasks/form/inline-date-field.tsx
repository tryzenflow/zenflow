import { Calendar, Check } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFlatList,
  BottomSheetOpenTrigger,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { zonedNow } from "@zenflow/core";
import { addDays, format, isSameDay } from "date-fns";
import { useMemo } from "react";
import type { ListRenderItemInfo } from "react-native";
import { Pressable, View } from "react-native";

const DAYS_AHEAD = 90;

/**
 * Compact "date pill" field for the deadline chip row's Custom date picker
 * (`mockups/task-sheets.html`'s grid-cols-2 date button). No native date
 * picker dependency is added here (`@react-native-community/datetimepicker`
 * would need a dev-client rebuild) — a scrollable day list matches the
 * thumb-friendly, build-from-existing-primitives spirit already used by
 * `components/onboarding/time-picker-row.tsx` for time-of-day.
 */
export function InlineDateField({
  value,
  onChange,
  tz,
  disabled,
}: {
  value: Date | undefined;
  onChange: (date: Date) => void;
  tz: string;
  disabled?: boolean;
}) {
  const bottomSheet = useBottomSheet();
  const days = useMemo(() => {
    const today = zonedNow(tz);
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
  }, [tz]);

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild disabled={disabled}>
        <Pressable
          className={cn(
            "h-[46px] flex-row items-center justify-between rounded-xl border border-input bg-card px-3",
            disabled && "opacity-50",
          )}
        >
          <Text className="text-[13.5px] font-medium text-foreground">
            {value ? format(value, "EEE, MMM d") : "Select date"}
          </Text>
          <Calendar size={16} className="shrink-0 text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={bottomSheet.ref}>
        <View className="px-5">
          <Text className="text-[19px] font-bold tracking-tight">
            Pick a date
          </Text>
        </View>
        <BottomSheetFlatList
          data={days}
          keyExtractor={(item) => (item as Date).toISOString()}
          className="mt-3 px-5"
          renderItem={({ item: rawItem }: ListRenderItemInfo<unknown>) => {
            const item = rawItem as Date;
            const selected = value ? isSameDay(item, value) : false;
            return (
              <Pressable
                onPress={() => {
                  onChange(item);
                  bottomSheet.close();
                }}
                className={cn(
                  "mb-2 flex-row items-center justify-between rounded-xl border px-4 py-3.5",
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card",
                )}
              >
                <Text
                  className={cn(
                    "text-[15px]",
                    selected
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground",
                  )}
                >
                  {format(item, "EEE, MMM d")}
                </Text>
                {selected && (
                  <View className="h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <Check size={12} className="text-primary-foreground" />
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      </BottomSheetContent>
    </BottomSheet>
  );
}
