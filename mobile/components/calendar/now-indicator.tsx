import { useEffect, useState } from "react";
import { View } from "react-native";
import { zonedNow, DAILY_HORIZON } from "@zenflow/core";

const TICK_MS = 60_000;

interface NowIndicatorProps {
  tz: string;
  totalHeight: number;
}

export function NowIndicator({ tz, totalHeight }: NowIndicatorProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const zoned = zonedNow(tz);
  const mins = zoned.getHours() * 60 + zoned.getMinutes();
  const top = (mins / DAILY_HORIZON) * totalHeight;

  return (
    <View
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top }}
    >
      <View className="relative flex-row items-center">
        <View className="absolute -left-1 h-2 w-2 rounded-full bg-rose-500 shadow-sm" />
        <View className="absolute -left-1 h-2 w-2 rounded-full bg-rose-500 shadow-sm opacity-50" />
        <View className="h-[2px] flex-1 bg-rose-500 opacity-60" />
      </View>
    </View>
  );
}
