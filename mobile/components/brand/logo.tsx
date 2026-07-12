import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

// Port of mobile/mockups/logo.svg — the Zenflow brand mark (orange -> yellow
// -> lime gradient ring with the "flow" swoosh).
function Logo({ size = 60 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 260 260" fill="none">
      <Defs>
        <LinearGradient id="zenflowLogoGradient" x1="48.5" y1="31.5" x2="222.5" y2="220.5">
          <Stop offset="0" stopColor="#ff8e3e" />
          <Stop offset="0.323567" stopColor="#F0B100" />
          <Stop offset="1" stopColor="#D8F999" />
        </LinearGradient>
      </Defs>
      <Circle cx={130} cy={130} r={130} fill="url(#zenflowLogoGradient)" />
      <Path
        d="M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5"
        stroke="#FFF085"
        strokeWidth={24}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export { Logo };
