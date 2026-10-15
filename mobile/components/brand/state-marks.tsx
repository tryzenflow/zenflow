import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

/** The logo's middle curve (components/logo.tsx). */
const CURVE =
  "M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5";

/** No results: a faded sun with the curve as a dotted trail (mockups/brand-loader.html). */
export function NoResultsMark({ size = 84 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 260 260" fill="none">
      <Defs>
        <LinearGradient
          id="zf-noresults"
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
      <Circle cx={130} cy={130} r={126} fill="url(#zf-noresults)" opacity={0.28} />
      <Circle
        cx={130}
        cy={130}
        r={126}
        stroke="#FF8E3E"
        strokeOpacity={0.45}
        strokeWidth={5}
        strokeDasharray="2 14"
        strokeLinecap="round"
      />
      <Path
        d={CURVE}
        stroke="#FF8E3E"
        strokeWidth={20}
        strokeLinecap="round"
        strokeDasharray="0.1 26.2"
      />
    </Svg>
  );
}

/** Load failed: a dimmed sun with a break in the curve (mockups/brand-loader.html). */
export function ErrorMark({ size = 84 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 260 260" fill="none">
      <Defs>
        <LinearGradient
          id="zf-error"
          x1={48.5}
          y1={31.5}
          x2={222.5}
          y2={220.5}
          gradientUnits="userSpaceOnUse"
        >
          <Stop stopColor="#C9A58C" offset={0} />
          <Stop stopColor="#B9AE9C" offset={0.45} />
          <Stop stopColor="#C8C7B4" offset={1} />
        </LinearGradient>
      </Defs>
      <Circle cx={130} cy={130} r={130} fill="url(#zf-error)" />
      <Path
        d={CURVE}
        stroke="#F4EBDD"
        strokeWidth={24}
        strokeLinecap="round"
        strokeDasharray="105 53 400"
      />
    </Svg>
  );
}
