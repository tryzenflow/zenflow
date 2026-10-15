import type { ColorValue } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

type TabIconProps = {
  // `Tabs.Screen`'s `tabBarIcon` (expo-router, re-vendored bottom-tabs) hands
  // this through as `ColorValue` (nullable) now, not a plain `string` --
  // matches what `Line`/`Rect`'s own `stroke`/`fill` props accept anyway.
  color: ColorValue;
  size: number;
};

/**
 * Tab bar glyphs. The calendar glyph is hand-ported from
 * mockups/week-view.html's tab bar (lucide's CalendarDays/LayoutGrid don't
 * match that mark).
 */
export function WeekTabIcon({ color, size }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3}
        y={4}
        width={18}
        height={17}
        rx={2}
        stroke={color}
        strokeWidth={2}
      />
      <Line x1={3} y1={9} x2={21} y2={9} stroke={color} strokeWidth={2} />
      <Line x1={9} y1={9} x2={9} y2={21} stroke={color} strokeWidth={2} />
      <Line x1={15} y1={9} x2={15} y2={21} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** A sun over a horizon: today's date in the calendar tab bar. */
export function TodayTabIcon({ color, size }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={4} stroke={color} strokeWidth={2} />
      <Line x1={12} y1={2} x2={12} y2={4} stroke={color} strokeWidth={2} />
      <Line x1={12} y1={20} x2={12} y2={22} stroke={color} strokeWidth={2} />
      <Line x1={2} y1={12} x2={4} y2={12} stroke={color} strokeWidth={2} />
      <Line x1={20} y1={12} x2={22} y2={12} stroke={color} strokeWidth={2} />
      <Line x1={4.9} y1={4.9} x2={6.3} y2={6.3} stroke={color} strokeWidth={2} />
      <Line x1={17.7} y1={17.7} x2={19.1} y2={19.1} stroke={color} strokeWidth={2} />
      <Line x1={4.9} y1={19.1} x2={6.3} y2={17.7} stroke={color} strokeWidth={2} />
      <Line x1={17.7} y1={6.3} x2={19.1} y2={4.9} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** A head and shoulders: the Me tab. */
export function MeTabIcon({ color, size }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={2} />
      <Path
        d="M4 21c0-4 3.6-7 8-7s8 3 8 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
