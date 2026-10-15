import { useLanguage } from "@/hooks/use-language";
import { dateFnsLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  addDays,
  format,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "@/components/Icons";
import { Pressable, View } from "react-native";
import { Text } from "./text";

/**
 * One week at a time, Monday first. Tap a day to pick it, or step the week
 * with the chevrons (which moves the selected day by a week too). `value` and
 * `minDate` are `YYYY-MM-DD`. Days before `minDate` are dimmed, not hidden.
 */
export function WeekStripDatePicker({
  value,
  onChange,
  minDate,
  disabled,
  testID,
}: {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  disabled?: boolean;
  testID?: string;
}) {
  useLanguage();
  const selected = startOfDay(parseISO(value));
  const floor = minDate ? startOfDay(parseISO(minDate)) : undefined;
  const today = startOfDay(new Date());
  const weekStart = startOfWeek(selected, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const locale = dateFnsLocale();

  function shift(days: number) {
    onChange(format(addDays(selected, days), "yyyy-MM-dd"));
  }

  return (
    <View testID={testID} className="gap-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          testID={testID ? `${testID}.prev` : undefined}
          disabled={disabled}
          onPress={() => shift(-7)}
          accessibilityLabel={t("Previous week")}
          className="size-11 items-center justify-center rounded-full"
        >
          <ChevronLeft size={18} className="text-muted-foreground" />
        </Pressable>
        <Text className="text-[13.5px] font-semibold capitalize text-foreground">
          {format(weekStart, "MMMM yyyy", { locale })}
        </Text>
        <Pressable
          testID={testID ? `${testID}.next` : undefined}
          disabled={disabled}
          onPress={() => shift(7)}
          accessibilityLabel={t("Next week")}
          className="size-11 items-center justify-center rounded-full"
        >
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </View>
      <View className="flex-row justify-between gap-1">
        {days.map((day) => {
          const active = isSameDay(day, selected);
          const blocked = !!floor && isBefore(day, floor);
          const iso = format(day, "yyyy-MM-dd");
          return (
            <Pressable
              key={iso}
              testID={testID ? `${testID}.${iso}` : undefined}
              disabled={disabled || blocked}
              onPress={() => onChange(iso)}
              accessibilityRole="button"
              accessibilityLabel={format(day, "EEEE, MMMM d", { locale })}
              accessibilityState={{ selected: active, disabled: blocked }}
              className={cn(
                "h-[68px] flex-1 items-center justify-center rounded-2xl border border-border bg-muted",
                active && "border-primary/50 bg-primary/15",
                blocked && "opacity-40",
              )}
            >
              <Text
                className={cn(
                  "text-[11px] font-medium text-muted-foreground",
                  active && "text-primary",
                )}
              >
                {format(day, "EEEEEE", { locale })}
              </Text>
              <Text
                className={cn(
                  "mt-1 text-[17px] font-semibold tabular-nums text-foreground",
                  active && "text-primary",
                )}
              >
                {format(day, "d")}
              </Text>
              {isSameDay(day, today) && (
                <View className="absolute bottom-1.5 size-1 rounded-full bg-primary" />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
