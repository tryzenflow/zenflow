import { MonthCell } from "@/components/calendar/month-cell";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import type { DayBar } from "@/lib/day-bar";
import { formatTitle } from "@/lib/i18n";
import { dateKey, isOutsideMonth } from "@/lib/month-date-math";
import { isSameDay } from "date-fns";
import { type RefObject, memo } from "react";
import { type HostInstance, View } from "react-native";

/** Rows of 7: `getMonthGridDays` always returns whole Monday-first weeks. */
function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

interface MonthGridProps {
  monthDate: Date;
  days: Date[];
  today: Date;
  selectedKey: string;
  bars: Map<string, DayBar>;
  /** Wraps the rows of day cells, so a drag can find the cell under the finger. */
  bodyRef?: RefObject<HostInstance | null>;
  /** The day a dragged session is over. */
  dropKey?: string | null;
  onPressDay: (day: Date) => void;
}

/**
 * Compact Monday-first month grid: a weekday row, then rows of day cells with
 * their load bars. Plain `View` rows, never a nested list, and it never scrolls.
 */
export const MonthGrid = memo(function MonthGrid({
  monthDate,
  days,
  today,
  selectedKey,
  bars,
  bodyRef,
  dropKey,
  onPressDay,
}: MonthGridProps) {
  useLanguage();
  const openDay =
    days.find((d) => isSameDay(d, today) && !isOutsideMonth(d, monthDate)) ??
    new Date(monthDate.getFullYear(), monthDate.getMonth(), 15);
  const openDayKey = dateKey(openDay);
  return (
    <View className="px-1">
      <View className="flex-row border-b border-border pb-1.5">
        {days.slice(0, 7).map((day) => (
          <Text
            key={dateKey(day)}
            className="flex-1 text-center text-[12px] font-semibold text-muted-foreground"
          >
            {formatTitle(day, "EEEEE")}
          </Text>
        ))}
      </View>
      <View ref={bodyRef} collapsable={false}>
      {chunkIntoWeeks(days).map((week) => (
        <View key={dateKey(week[0])} className="flex-row">
          {week.map((day) => {
            const key = dateKey(day);
            return (
              <MonthCell
                key={key}
                day={day}
                outside={isOutsideMonth(day, monthDate)}
                isToday={isSameDay(day, today)}
                isSelected={key === selectedKey}
                bar={bars.get(key)}
                openDayTip={key === openDayKey}
                isDrop={key === dropKey}
                onPressDay={onPressDay}
              />
            );
          })}
        </View>
      ))}
      </View>
    </View>
  );
});
