import { Text } from "@/components/ui/text";
import { minutesToTime } from "@zenflow/core";
import { View } from "react-native";

interface TimeGutterProps {
  hourHeight: number;
  fromHour?: number;
  toHour?: number;
  showZeroLabel?: boolean;
}

export function TimeGutter({
  hourHeight,
  fromHour = 0,
  toHour = 24,
  showZeroLabel = false,
}: TimeGutterProps) {
  const hours: number[] = [];
  for (let h = fromHour; h < toHour; h++) hours.push(h);

  return (
    <View
      className="absolute left-0 top-0 bottom-0 border-r border-black/15 dark:border-white/15"
      style={{ width: 64 }}
    >
      {hours.map((hour) => (
        <View
          key={hour}
          style={{ height: hourHeight }}
          className="items-end justify-start pr-2 pt-0"
        >
          {(hour !== 0 || showZeroLabel) && (
            <Text className="text-[10px] font-bold text-muted-foreground">
              {minutesToTime(hour * 60)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
