import type { ColorValue } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

/**
 * Zenflow's own glyph set (design.md, "Ownable marks"): 2px round strokes,
 * generous radii and the logo's arc/horizon motif, so the chrome doesn't read
 * as a stock icon pack. Brand and hero surfaces use these, not lucide.
 */
type IconProps = { color: ColorValue; size?: number };

const STROKE = { strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Two sliders with round knobs; replaces lucide's gear in the tab bar. */
export function SettingsIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={4} y1={8} x2={20} y2={8} stroke={color} {...STROKE} />
      <Line x1={4} y1={16} x2={20} y2={16} stroke={color} {...STROKE} />
      <Circle cx={9} cy={8} r={2.6} fill="none" stroke={color} {...STROKE} />
      <Circle cx={15} cy={16} r={2.6} fill="none" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Low sun on a horizon: empty day / "nothing yet". */
export function SunriseIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={3} y1={18} x2={21} y2={18} stroke={color} {...STROKE} />
      <Path d="M7 18a5 5 0 0 1 10 0" stroke={color} {...STROKE} />
      <Line x1={12} y1={6} x2={12} y2={8.5} stroke={color} {...STROKE} />
      <Line x1={5.6} y1={9.6} x2={7.2} y2={11.2} stroke={color} {...STROKE} />
      <Line x1={18.4} y1={9.6} x2={16.8} y2={11.2} stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Sun slipping under the horizon with a slash: offline (dusk, not an error). */
export function DuskIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={3} y1={18} x2={21} y2={18} stroke={color} {...STROKE} />
      <Path d="M7 18a5 5 0 0 1 10 0" stroke={color} {...STROKE} />
      <Line x1={5} y1={5} x2={19} y2={14} stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Calendar page with a sun dot: jump to today. */
export function TodayIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={4} width={18} height={17} rx={4} stroke={color} {...STROKE} />
      <Line x1={3} y1={9} x2={21} y2={9} stroke={color} {...STROKE} />
      <Circle cx={12} cy={15} r={2.4} fill={color} />
    </Svg>
  );
}

/** Soft plus whose arms end in round caps: create. */
export function AddIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={12} y1={5} x2={12} y2={19} stroke={color} {...STROKE} />
      <Line x1={5} y1={12} x2={19} y2={12} stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Check with an arc tail: synced / done. */
export function SyncedIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.5l4.2 4.2L19 7" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Soft chevron pointing back. */
export function BackIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M14.5 5.5L8 12l6.5 6.5" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Open dial with one hand: waiting / cooldown. */
export function WaitIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" stroke={color} {...STROKE} />
      <Path d="M12 7.5V12l3 2" stroke={color} {...STROKE} />
    </Svg>
  );
}
