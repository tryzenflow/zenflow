import { getLanguage } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { Text } from "@/components/ui/text";
import { minutesToTime } from "@zenflow/core";
import { View } from "react-native";

interface TimeGutterProps {
  hourHeight: number;
  fromHour?: number;
  toHour?: number;
  showZeroLabel?: boolean;
  /** Midnight again at the bottom, tagged "+1" (next day). Only when the grid ends at 24:00. */
  showEndLabel?: boolean;
}

export function TimeGutter({
  hourHeight,
  fromHour = 0,
  toHour = 24,
  showZeroLabel = true,
  showEndLabel = true,
}: TimeGutterProps) {
  useLanguage();
  const hours: number[] = [];
  for (let h = fromHour; h < toHour; h++) hours.push(h);

  const label = (hour: number) =>
    getLanguage() === "vi"
      ? `${String(hour % 24).padStart(2, "0")}:00`
      : minutesToTime((hour % 24) * 60);

  return (
    <View
      className="absolute left-0 top-0 bottom-0 border-r border-black/15 dark:border-border"
      style={{ width: 64 }}
    >
      {hours.map((hour) => (
        <View
          key={hour}
          style={{ height: hourHeight }}
          className="items-end justify-start pr-2 pt-0"
        >
          {(hour !== 0 || showZeroLabel) && (
            <Text className="text-[11px] font-medium text-muted-foreground">
              {label(hour)}
            </Text>
          )}
        </View>
      ))}
      {showEndLabel && toHour === 24 && (
        <View
          pointerEvents="none"
          className="absolute right-2 flex-row items-start"
          style={{ top: hours.length * hourHeight }}
        >
          <Text className="text-[11px] font-medium text-muted-foreground">
            {label(24)}
          </Text>
          <Text
            className="ml-px text-[8px] font-bold text-primary"
            style={{ marginTop: -1 }}
          >
            +1
          </Text>
        </View>
      )}
    </View>
  );
}
