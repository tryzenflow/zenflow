import { useLanguage } from "@/hooks/use-language";
import { t, locale } from "@/lib/i18n";
import { Calendar, ChevronLeft, ChevronRight } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetOpenTrigger,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { zonedNow } from "@zenflow/core";
import { addDays, addMonths, startOfMonth } from "date-fns";
import { format, formatTitle } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";

const DAYS_AHEAD = 60;

/** Android's OS date picker ignores locale; this grid follows the app language. */
function LocalizedDateGrid({
  value,
  minimumDate,
  maximumDate,
  onChange,
}: {
  value: Date;
  minimumDate: Date;
  maximumDate?: Date;
  onChange: (date: Date) => void;
}) {
  useLanguage();
  const [month, setMonth] = useState(() => startOfMonth(value));
  useEffect(() => setMonth(startOfMonth(value)), [value]);
  const offset = (month.getDay() + 6) % 7;
  const first = addDays(month, -offset);
  const before = addDays(month, -1) >= minimumDate;
  const after = !maximumDate || addMonths(month, 1) <= maximumDate;
  const weekdays =
    locale() === "vi-VN"
      ? ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <View className="w-full gap-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          disabled={!before}
          onPress={() => setMonth(addMonths(month, -1))}
          accessibilityLabel={t("Previous month")}
          className="p-3"
          style={{ opacity: before ? 1 : 0.3 }}
        >
          <ChevronLeft size={20} className="text-foreground" />
        </Pressable>
        <Text className="font-semibold">{formatTitle(month, "MMMM yyyy")}</Text>
        <Pressable
          disabled={!after}
          onPress={() => setMonth(addMonths(month, 1))}
          accessibilityLabel={t("Next month")}
          className="p-3"
          style={{ opacity: after ? 1 : 0.3 }}
        >
          <ChevronRight size={20} className="text-foreground" />
        </Pressable>
      </View>
      <View className="flex-row">
        {weekdays.map((day) => (
          <Text
            key={day}
            className="flex-1 text-center text-sm text-muted-foreground"
          >
            {day}
          </Text>
        ))}
      </View>
      {Array.from({ length: 6 }, (_, week) => (
        <View key={week} className="flex-row">
          {Array.from({ length: 7 }, (_, index) => {
            const date = addDays(first, week * 7 + index);
            const available =
              date >= minimumDate && (!maximumDate || date <= maximumDate);
            const selected = date.getTime() === dayStart(value).getTime();
            return (
              <Pressable
                key={index}
                disabled={!available}
                onPress={() => onChange(dayStart(date))}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !available }}
                accessibilityLabel={format(date, "EEEE, d MMMM yyyy")}
                className={cn(
                  "h-10 flex-1 items-center justify-center rounded-full",
                  selected && "bg-primary",
                )}
                style={{
                  opacity: available
                    ? date.getMonth() === month.getMonth()
                      ? 1
                      : 0.5
                    : 0.25,
                }}
              >
                <Text
                  className={cn(
                    "text-sm",
                    selected && "text-primary-foreground",
                  )}
                >
                  {date.getDate()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function dayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Date pill for task forms. Vietnamese Android uses an in-app calendar;
 * English Android and iOS use the native date picker. Values keep user-timezone
 * wall-clock fields and are normalized to midnight before onChange.
 * Native picker changes require a dev-client rebuild (see mobile/README.md).
 */
export function InlineDateField({
  value,
  onChange,
  tz,
  disabled,
  minDate,
  maxDate,
  unboundedFuture,
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
  /** Drop the default `DAYS_AHEAD` forward cap entirely, so any future date is
   * selectable (fixed sessions — a class/exam can be months out). Ignored when
   * an explicit `maxDate` is given. */
  unboundedFuture?: boolean;
}) {
  useLanguage();
  const { minimumDate, maximumDate } = useMemo(() => {
    const today = dayStart(zonedNow(tz));
    const floor =
      minDate && dayStart(minDate) > today ? dayStart(minDate) : today;
    const ceiling = maxDate
      ? dayStart(maxDate)
      : unboundedFuture
        ? undefined
        : addDays(floor, DAYS_AHEAD - 1);
    return { minimumDate: floor, maximumDate: ceiling };
  }, [tz, minDate, maxDate, unboundedFuture]);

  // Falls back to `minimumDate` (today in `tz`, or `minDate`) when nothing is
  // selected yet, so the native picker always opens somewhere in range.
  const anchor = value ?? minimumDate;

  const [open, setOpen] = useState(false);
  const bottomSheet = useBottomSheet();

  const trigger = (
    <Pressable
      onPress={
        Platform.OS === "android" && locale() !== "vi-VN"
          ? () => setOpen(true)
          : undefined
      }
      disabled={disabled}
      className={cn(
        "h-[46px] flex-row items-center justify-between rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07] px-3",
        disabled && "opacity-50",
      )}
    >
      <Text className="text-[13.5px] font-medium text-foreground">
        {value
          ? format(value, "EEE, MMM d")
          : t("Select date")}
      </Text>
      <Calendar size={16} className="shrink-0 text-muted-foreground" />
    </Pressable>
  );

  if (Platform.OS === "android" && locale() !== "vi-VN") {
    const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
      setOpen(false);
      if (event.type === "dismissed" || !selected) return;
      onChange(dayStart(selected));
    };
    return (
      <>
        {trigger}
        {open && (
          <DateTimePicker
            value={anchor}
            locale={locale()}
            mode="date"
            display="default"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={handleChange}
          />
        )}
      </>
    );
  }

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild disabled={disabled}>
        {trigger}
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={bottomSheet.ref}>
        {/* Dynamic sizing only measures gorhom's own `BottomSheetView` (or
            scrollables); bare children measure 0 high and the sheet never
            appears. */}
        <BottomSheetView hadHeader={false} className="px-0">
          <View className="px-5">
            <Text className="text-[19px] font-bold tracking-tight">
              {t("Pick a date")}
            </Text>
          </View>
          <View className="mt-3 items-center px-5">
            {Platform.OS === "android" ? (
              <LocalizedDateGrid
                value={anchor}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={onChange}
              />
            ) : (
              <DateTimePicker
                value={anchor}
                locale={locale()}
                mode="date"
                display="inline"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={(_event, selected) => {
                  if (selected) onChange(dayStart(selected));
                }}
              />
            )}
          </View>
          <View className="px-5 pt-4">
            <Button className="w-full" onPress={bottomSheet.close}>
              <Text className="font-semibold text-primary-foreground">
                {t("Done")}
              </Text>
            </Button>
          </View>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
}
