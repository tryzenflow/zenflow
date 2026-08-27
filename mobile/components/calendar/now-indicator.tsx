import { DAILY_HORIZON } from "@zenflow/core";
import { toZonedTime } from "date-fns-tz";
import { View } from "react-native";

interface NowIndicatorProps {
  now: Date;
  tz: string;
  totalHeight: number;
}

export function NowIndicator({ now, tz, totalHeight }: NowIndicatorProps) {
  const zoned = toZonedTime(now, tz);
  const mins = zoned.getHours() * 60 + zoned.getMinutes();
  const top = (mins / DAILY_HORIZON) * totalHeight;

  return (
    <View
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top }}
    >
      <View className="relative flex-row items-center">
        <View className="absolute -left-1 h-2 w-2 rounded-full bg-brand-orange shadow-sm" />
        <View className="absolute -left-1 h-2 w-2 rounded-full bg-brand-orange shadow-sm opacity-50" />
        <View className="h-[2px] flex-1 bg-brand-orange opacity-60" />
      </View>
    </View>
  );
}
