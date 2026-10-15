import { useLanguage } from "@/hooks/use-language";
import { View } from "react-native";

interface NowIndicatorProps {
  /** Y (px) of the current time on the day grid (`minToY` of the wall clock). */
  top: number;
}

export function NowIndicator({ top }: NowIndicatorProps) {
  useLanguage();
  return (
    <View
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top }}
    >
      <View className="relative flex-row items-center">
        <View className="absolute -left-1 h-2 w-2 rounded-full bg-primary shadow-sm" />
        <View className="absolute -left-1 h-2 w-2 rounded-full bg-primary shadow-sm opacity-50" />
        <View className="h-[2px] flex-1 bg-primary opacity-60" />
      </View>
    </View>
  );
}
