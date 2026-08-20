import { Text } from "@/components/ui/text";
import { dateKey, weekDays } from "@/lib/week-date-math";
import { zonedNow } from "@zenflow/core";
import { format } from "date-fns";
import { Pressable, View } from "react-native";

interface WeekHeaderProps {
  /** The day the pager is focused on — drives the title and range, and the
   * `bg-muted` chip highlight. */
  focusedDate: Date;
  tz: string;
  onSelectDay: (day: Date) => void;
}

/**
 * Sticky header above the week pager — RN port of mockups/week-view.html's
 * title row (month + week range) and the 7-day chip strip. Highlights are
 * independent (mockup's Wednesday):
 * - focused day → `bg-muted` chip container (the pager sits on it);
 * - today → `bg-primary` filled number circle (when today is focused, both).
 *
 * `focusedDate` is the committed focus, so a swipe that settles on an edge
 * day (which slides the window a week) re-renders the range/title from the
 * new week; the pager calls `onSelectDay` on chip taps and keeps itself
 * aligned via `onFocusedDateChange`.
 */
export function WeekHeader({ focusedDate, tz, onSelectDay }: WeekHeaderProps) {
  const now = zonedNow(tz);
  const days = weekDays(focusedDate);
  const focusedKey = dateKey(focusedDate);
  const todayKey = dateKey(now);

  return (
    <View className="border-b border-border bg-background pt-2.5 pb-2">
        <View className="px-4 pb-2">
        <Text className="text-xl font-bold tracking-tight">
          {format(focusedDate, "MMMM yyyy")}
        </Text>
        <Text className="mt-px text-[11.5px] font-medium text-muted-foreground">
          {format(days[0], "MMM d")} – {format(days[6], "MMM d")}
        </Text>
      </View>

      <View className="flex-row gap-1.5 pt-1 pb-0.5 border-t border-border">
        {days.map((day) => {
          const key = dateKey(day);
          const isFocused = key === focusedKey;
          const isToday = key === todayKey;
          return (
            <Pressable
              key={key}
              onPress={() => onSelectDay(day)}
              className={`flex-1 items-center gap-1 rounded-xl py-1.5 ${
                isFocused ? "bg-muted" : ""
              }`}
              accessibilityLabel={`${format(day, "EEEE, MMMM d")}${
                isToday ? ", today" : ""
              }`}
            >
              <Text className="text-[10.5px] font-semibold uppercase text-muted-foreground">
                {format(day, "EEE")}
              </Text>
              <View
                className={`h-[30px] w-[30px] items-center justify-center rounded-full text-base ${
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground"
                }`}
              >
                <Text
                  className={`text-base font-semibold ${
                    isToday ? "text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {format(day, "d")}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
