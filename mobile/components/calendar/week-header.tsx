import { Text } from "@/components/ui/text";
import { dateKey, shiftWeek, weekDays } from "@/lib/week-date-math";
import { useNow } from "@/hooks/use-now";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

/** Horizontal drag distance / fling speed that commits a week change. */
const WEEK_SWIPE_DISTANCE = 48;
const WEEK_SWIPE_VELOCITY = 500;

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
  const now = useNow();
  const days = useMemo(() => weekDays(focusedDate), [focusedDate]);
  const focusedKey = useMemo(() => dateKey(focusedDate), [focusedDate]);
  const todayKey = useMemo(() => dateKey(toZonedTime(now, tz)), [now, tz]);

  // Swipe the header left/right to jump a whole week, keeping the same
  // weekday selected. `onSelectDay` with a day outside the pager's 3-day
  // window makes it rebuild around the new week (same path as a chip tap to
  // an off-window day — an instant switch). `activeOffsetX` keeps chip taps
  // working — the pan only takes over after a deliberate horizontal drag;
  // `failOffsetY` yields vertical drags to the pager below. `runOnJS` since
  // the handler only calls back into React, no UI-thread work.
  const weekSwipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-16, 16])
        .failOffsetY([-14, 14])
        .onEnd((e) => {
          const forward =
            e.translationX <= -WEEK_SWIPE_DISTANCE ||
            e.velocityX <= -WEEK_SWIPE_VELOCITY;
          const backward =
            e.translationX >= WEEK_SWIPE_DISTANCE ||
            e.velocityX >= WEEK_SWIPE_VELOCITY;
          if (forward) onSelectDay(shiftWeek(focusedDate, 1));
          else if (backward) onSelectDay(shiftWeek(focusedDate, -1));
        }),
    [focusedDate, onSelectDay],
  );

  return (
    <GestureDetector gesture={weekSwipe}>
      <View className="border-b border-border bg-background pt-2.5 pb-2">
        <View className="px-4 pb-2">
          <Text className="text-xl font-bold tracking-tight">
            {format(focusedDate, "MMMM yyyy")}
          </Text>
          <Text className="mt-px text-[11.5px] font-medium text-muted-foreground">
            {format(days[0], "MMM d")} – {format(days[6], "MMM d")}
          </Text>
        </View>

        <View className="flex-row gap-1.5 px-4 pt-1 pb-0.5">
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
    </GestureDetector>
  );
}
