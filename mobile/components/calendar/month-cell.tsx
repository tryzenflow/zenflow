import { SpotlightAnchor } from "@/components/checklist/spotlight-anchor";
import { DayBarView } from "@/components/calendar/day-bar";
import { Text } from "@/components/ui/text";
import { useSpotlight } from "@/hooks/use-spotlight";
import type { DayBar } from "@/lib/day-bar";
import { cn } from "@/lib/utils";
import { memo } from "react";
import { Pressable, View } from "react-native";

/** Row height of the compact month grid (points). */
export const CELL_HEIGHT = 54;

interface MonthCellProps {
  day: Date;
  /** Falls outside the month on screen: dimmed. */
  outside: boolean;
  isToday: boolean;
  isSelected: boolean;
  /** Load bar for the day; absent while loading or on an empty day. */
  bar?: DayBar;
  /** The checklist's "open a day" tip points here. */
  openDayTip: boolean;
  onPressDay: (day: Date) => void;
}

/**
 * One day of the month grid: the date, then a thin bar of that day's load
 * (timetable blue, free time gray, task orange). Tap selects the day; its
 * sessions list under the grid. The children never change shape, so the
 * cell survives a view switch.
 */
export const MonthCell = memo(function MonthCell({
  day,
  outside,
  isToday,
  isSelected,
  bar,
  openDayTip,
  onPressDay,
}: MonthCellProps) {
  const tipActive = useSpotlight((s) => s.step === "open-day");
  return (
    <Pressable
      onPress={() => onPressDay(day)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${day.getDate()}`}
      testID={`month-cell.${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`}
      style={{ width: `${100 / 7}%`, height: CELL_HEIGHT }}
      className="items-center gap-1.5 pt-1"
    >
      {/* Fixed slot: the tip toggling must not shift sibling indexes. */}
      <View pointerEvents="box-none" className="absolute inset-0">
        {openDayTip && tipActive ? <SpotlightAnchor step="open-day" /> : null}
      </View>
      <View
        className={cn(
          "h-[30px] w-[30px] items-center justify-center rounded-full",
          isToday
            ? "bg-primary"
            : isSelected
              ? "bg-foreground/10"
              : "bg-transparent",
          isSelected && !isToday && "border border-foreground/30",
        )}
      >
        <Text
          className={cn(
            "text-[16px] font-semibold",
            isToday
              ? "text-primary-foreground"
              : outside
                ? "text-muted-foreground opacity-60"
                : "text-foreground",
          )}
        >
          {day.getDate()}
        </Text>
      </View>
      <View className={cn("w-[70%]", outside && "opacity-50")}>
        <DayBarView bar={bar} />
      </View>
    </Pressable>
  );
});
