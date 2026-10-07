import { useMotion } from "@/hooks/use-motion";
import { cn } from "@/lib/utils";
import * as React from "react";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const duration = 1000;

function Skeleton({
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof Animated.View>, "style">) {
  const { reduced } = useMotion();
  const sv = useSharedValue(1);

  // Static placeholder under Reduce Motion; the pulse is decoration only.
  React.useEffect(() => {
    if (reduced) {
      cancelAnimation(sv);
      sv.value = 1;
      return;
    }
    sv.value = withRepeat(
      withSequence(withTiming(0.5, { duration }), withTiming(1, { duration })),
      -1,
    );
    return () => cancelAnimation(sv);
  }, [reduced, sv]);

  const style = useAnimatedStyle(() => ({
    opacity: sv.value,
  }));

  return (
    <Animated.View
      style={style}
      className={cn("rounded-md bg-border", className)}
      {...props}
    />
  );
}

export { Skeleton };
