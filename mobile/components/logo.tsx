import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";

/**
 * Zenflow sunrise mark — ported from frontend/src/components/logo.tsx (react-native-svg
 * instead of inline <svg>; no CSS hover/breathe animation on native, static mark).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <View className={cn("aspect-square", className)}>
      <Svg viewBox="0 0 260 260" width="100%" height="100%" fill="none">
        <Circle cx={130} cy={130} r={130} fill="url(#zenflow-sunrise)" />
        <Path
          d="M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5"
          stroke="#FFF085"
          strokeWidth={24}
          strokeLinecap="round"
        />
        <Defs>
          <LinearGradient
            id="zenflow-sunrise"
            x1={48.5}
            y1={31.5}
            x2={222.5}
            y2={220.5}
            gradientUnits="userSpaceOnUse"
          >
            <Stop stopColor="#FF6900" offset={0} />
            <Stop stopColor="#F0B100" offset={0.323567} />
            <Stop stopColor="#D8F999" offset={1} />
          </LinearGradient>
        </Defs>
      </Svg>
    </View>
  );
}

/** Logo + "Zenflow" wordmark lockup. */
export function Wordmark({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <View className={cn("flex-row items-center gap-2", className)}>
      <Logo className={cn("h-9 w-9 shrink-0", iconClassName)} />
      <Text className="text-xl font-semibold tracking-tight">Zenflow</Text>
    </View>
  );
}
