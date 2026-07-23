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
import { addDays, differenceInCalendarDays, format, isSameDay } from "date-fns";
import { useMemo } from "react";
import type { ListRenderItemInfo } from "react-native";
import { Pressable, View } from "react-native";

const DAYS_AHEAD = 90;

function dayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Compact "date pill" field for the deadline chip row's Custom date picker
 * (`mockups/task-sheets.html`'s grid-cols-2 date button). No native date
 * picker dependency is added here (`@react-native-community/datetimepicker`
 * would need a dev-client rebuild) — a scrollable day list matches the
 * thumb-friendly, build-from-existing-primitives spirit already used by
 * `components/ui/time-picker.tsx` for time-of-day.
 *
 * The list is always a flat, chronological scroll — deliberately no
 * month/year jump navigation — so callers that need a bounded range (e.g.
 * `OptimizeFab`'s 60-day-max window) just pass `minDate`/`maxDate` rather
 * than this field growing a second navigation mode.
 */
export function InlineDateField({
  value,
  onChange,
  tz,
  disabled,
  minDate,
  maxDate,
}: {
  value: Date | undefined;
  onChange: (date: Date) => void;
  tz: string;
  disabled?: boolean;
  /** Earliest selectable date, inclusive. Defaults to today in `tz` — dates
   * before today (in `tz`) are never selectable even if a caller passes an
   * earlier `minDate`. */
  minDate?: Date;
  /** Latest selectable date, inclusive. Defaults to `minDate + DAYS_AHEAD - 1`. */
  maxDate?: Date;
}) {
  const bottomSheet = useBottomSheet();
  const days = useMemo(() => {
    const today = dayStart(zonedNow(tz));
    const floor =
      minDate && dayStart(minDate) > today ? dayStart(minDate) : today;
    const ceiling = maxDate
      ? dayStart(maxDate)
      : addDays(floor, DAYS_AHEAD - 1);
    const span = Math.max(1, differenceInCalendarDays(ceiling, floor) + 1);
    return Array.from({ length: span }, (_, i) => addDays(floor, i));
  }, [tz, minDate, maxDate]);

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
