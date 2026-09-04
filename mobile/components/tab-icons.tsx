import Svg, { Line, Rect } from "react-native-svg";

type TabIconProps = {
  color: string;
  size: number;
};

/**
 * Calendar-with-columns / -grid glyphs, hand-ported from
 * mockups/week-view.html's tab bar (lucide's CalendarDays/LayoutGrid don't
 * match that mark). Settings keeps lucide's `Settings` gear, which already
 * matches the mockup exactly.
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

export function MonthTabIcon({ color, size }: TabIconProps) {
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
      <Line x1={3} y1={14} x2={21} y2={14} stroke={color} strokeWidth={2} />
      <Line x1={9} y1={9} x2={9} y2={21} stroke={color} strokeWidth={2} />
      <Line x1={15} y1={9} x2={15} y2={21} stroke={color} strokeWidth={2} />
    </Svg>
  );
}
