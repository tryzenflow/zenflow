import { SESSION_TONES, SESSION_TYPE_TONE } from "@zenflow/core";
import { View } from "react-native";
import type { DayBar } from "@/lib/day-bar";

/**
 * A day's load as one thin rounded bar: a stretch per session in time order,
 * tinted by type (timetable blue, task orange), gray for the free time between
 * them. A fixed-height slot, so an empty day reserves the same space.
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
      className="w-full flex-row overflow-hidden"
      style={{ height, borderRadius: height / 2 }}
    >
      {bar?.segments.map((segment, i) => (
        <View
          key={i}
          className={segment.kind === "gap" ? "bg-muted-foreground/25" : undefined}
          style={{
            flex: segment.flex,
            minWidth: 2,
            backgroundColor:
              segment.kind === "gap"
                ? undefined
                : SESSION_TONES[SESSION_TYPE_TONE[segment.kind]].base,
          }}
        />
      ))}
    </View>
  );
}
