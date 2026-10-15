import { getLanguage, t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { Text } from "@/components/ui/text";
import { type DayGrid, minToY, visibleHourMinutes } from "@/lib/day-grid";
import { minutesToTime } from "@zenflow/core";
import { View } from "react-native";

/** Width of the time column; the day grid starts here. Wide enough for "12:00 AM" with the "tomorrow" tag. */
export const TIME_GUTTER_WIDTH = 76;

interface TimeGutterProps {
  grid: DayGrid;
  showZeroLabel?: boolean;
  /** Midnight again at the bottom, tagged "tomorrow". */
  showEndLabel?: boolean;
}

/** Hour labels placed on the grid's bands. */
export function TimeGutter({
  grid,
  showZeroLabel = true,
  showEndLabel = true,
}: TimeGutterProps) {
  useLanguage();
  const label = (min: number) => {
    const hour = min / 60;
    return getLanguage() === "vi"
      ? `${String(hour % 24).padStart(2, "0")}:00`
      : minutesToTime((hour % 24) * 60);
  };

  return (
    <View
      className="absolute left-0 top-0 bottom-0 border-r border-black/15 dark:border-border"
      style={{ width: TIME_GUTTER_WIDTH }}
    >
      {visibleHourMinutes(grid).map((min) => (
        <View
          key={min}
          pointerEvents="none"
          className="absolute left-0 right-0 items-end pr-2"
          style={{ top: minToY(grid, min) }}
        >
          {(min !== 0 || showZeroLabel) && (
            <Text className="text-[12px] font-medium text-muted-foreground">
              {label(min)}
            </Text>
          )}
        </View>
      ))}
      {showEndLabel && (
        <View
          pointerEvents="none"
          className="absolute right-1.5 items-end"
          style={{ top: grid.height }}
        >
          <Text className="text-[12px] font-medium text-muted-foreground">
            {label(24 * 60)}
          </Text>
          <Text
            className="text-[9px] font-bold text-primary"
            style={{ marginTop: -1 }}
          >
            {t("tomorrow")}
          </Text>
        </View>
      )}
    </View>
  );
}
