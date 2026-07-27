import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { minutesToHour } from "@zenflow/core";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface TimeGutterProps {
  hourHeight: number;
}

export function TimeGutter({ hourHeight }: TimeGutterProps) {
  return (
    <View
      className="absolute left-0 top-0 bottom-0"
      style={{ width: 64 }}
    >
      {HOURS.map((hour) => (
        <View
          key={hour}
          style={{ height: hourHeight }}
          className="items-end justify-start pr-2 pt-0"
        >
          {hour !== 0 && (
            <Text className="text-[10px] font-bold text-muted-foreground">
              {minutesToHour(hour * 60)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
