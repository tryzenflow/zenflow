import { ChevronDown } from "@/components/Icons";
import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * Chevron for expandable rows: points down when closed and turns up when open.
 * The turn is on a wrapper, so the icon itself never loses its colour or size.
 */
export function ExpandChevron({
  open,
  size = 18,
}: {
  open: boolean;
  size?: number;
}) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, { duration: 180 });
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));
  return (
    <Animated.View style={style}>
      <ChevronDown size={size} className="text-muted-foreground" />
    </Animated.View>
  );
}
