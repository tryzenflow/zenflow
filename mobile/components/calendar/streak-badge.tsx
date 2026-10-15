import { Flame } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useTodayStore } from "@/hooks/use-today";
import { t } from "@/lib/i18n";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const FLAME_SIZE = 26;

/**
 * A live flame: the tip sways and the body shimmers on two loops of different
 * speed, so it never repeats the same shape twice in a row. An outer orange
 * layer with a yellow core.
 */
function LiveFlame() {
  const t1 = useSharedValue(0);
  useEffect(() => {
    t1.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.linear }),
      -1,
      false,
    );
  }, [t1]);

  const outer = useAnimatedProps(() => {
    const a = t1.value * Math.PI * 2;
    const sway = Math.sin(a) * 1.1 + Math.sin(a * 3) * 0.35;
    const lick = Math.sin(a * 2 + 1) * 0.9 + Math.sin(a * 5) * 0.3;
    const tipX = 12 + sway * 1.6;
    const tipY = 1 + lick * 0.8;
    const side = Math.sin(a * 3 + 2) * 0.6;
    return {
      d: `M12 23 C6 23 4.2 17.2 7.8 12.4 C8.4 14 9.4 14.6 10.2 13.8 C9.2 9.4 ${10.6 + sway * 0.6} ${5 + lick * 0.3} ${tipX} ${tipY} C${13.8 + sway * 0.7} ${5.2 + lick * 0.4} ${15.8 + side} 8.6 15.2 12.4 C16.2 12 16.8 11.4 17 10.4 C19.8 14.6 18.2 23 12 23 Z`,
    };
  });
  const core = useAnimatedProps(() => {
    const a = t1.value * Math.PI * 2;
    const sway = Math.sin(a + 0.6) * 0.8 + Math.sin(a * 3 + 1) * 0.3;
    const lick = Math.sin(a * 3 + 2) * 0.8;
    const tipX = 12 + sway * 1.1;
    const tipY = 12.6 + lick * 0.7;
    return {
      d: `M12 23 C8.8 23 8.2 19.6 10 17.6 C10.8 18.5 11.4 18.5 11.8 17.9 C11.6 15.6 ${11.8 + sway * 0.5} 14 ${tipX} ${tipY} C13.6 14.6 15.6 17 15 19.6 C14.6 21.8 13.5 23 12 23 Z`,
    };
  });

  return (
    <Svg width={FLAME_SIZE} height={FLAME_SIZE} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="zf-flame" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFB020" />
          <Stop offset="1" stopColor="#FF5A00" />
        </LinearGradient>
      </Defs>
      <AnimatedPath fill="url(#zf-flame)" animatedProps={outer} />
      <AnimatedPath fill="#FFE27A" animatedProps={core} />
    </Svg>
  );
}

/** Task streak next to the search button. A live flame once a task is done today, grey and still before. */
export function StreakBadge() {
  useLanguage();
  const count = useTodayStore((s) => s.streak?.current ?? 0);
  const todayDone = useTodayStore((s) => s.streak?.todayDone ?? false);

  return (
    <View
      testID="calendar-header.streak"
      accessibilityLabel={t("{count} day streak", { count })}
      className="h-11 flex-row items-center gap-1 rounded-full px-1"
    >
      {todayDone ? (
        <LiveFlame />
      ) : (
        <Flame size={22} className="text-muted-foreground" fill="none" />
      )}
      <Text
        className={
          todayDone
            ? "text-[16px] font-bold"
            : "text-[16px] font-bold text-muted-foreground"
        }
      >
        {count}
      </Text>
    </View>
  );
}
