import { SESSION_TONES, SESSION_TYPE_TONE } from "@zenflow/core";
import { View } from "react-native";
import type { DayBar } from "@/lib/day-bar";

/**
 * A day's load as one thin rounded bar on a fixed 24 hour track: gray for free
 * time, a tinted stretch (by type) where a session sits. A fixed-height slot,
 * so an empty day reserves the same space.
 */
export function DayBarView({
  bar,
  height = 4,
  testID,
}: {
  bar?: DayBar;
  height?: number;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      pointerEvents="none"
      className="w-full overflow-hidden bg-muted-foreground/30"
      style={{ height, borderRadius: height / 2 }}
    >
      {bar?.segments.map((segment) => (
        <View
          key={`${segment.start}-${segment.kind}`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${(segment.start / 1440) * 100}%`,
            width: `${((segment.end - segment.start) / 1440) * 100}%`,
            minWidth: 3,
            backgroundColor: SESSION_TONES[SESSION_TYPE_TONE[segment.kind]].base,
          }}
        />
      ))}
    </View>
  );
}
