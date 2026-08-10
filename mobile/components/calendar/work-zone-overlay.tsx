import { View } from "react-native";
import { DAY_PX, DEFAULT_WORK_PREFS, getDayZones } from "@zenflow/core";
import type { UserPreferences } from "@zenflow/shared";

interface WorkZoneOverlayProps {
  date: Date;
  prefs?: Pick<UserPreferences, "workStart" | "workEnd" | "workDays">;
  hourHeight?: number;
}

function nonWorkGaps(segments: { topPx: number; bottomPx: number }[]) {
  const sorted = [...segments].sort((a, b) => a.topPx - b.topPx);
  const gaps: { topPx: number; bottomPx: number }[] = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.topPx > cursor) gaps.push({ topPx: cursor, bottomPx: seg.topPx });
    cursor = Math.max(cursor, seg.bottomPx);
  }
  if (cursor < DAY_PX) gaps.push({ topPx: cursor, bottomPx: DAY_PX });
  return gaps;
}

export function WorkZoneOverlay({ date, prefs = DEFAULT_WORK_PREFS, hourHeight = 64 }: WorkZoneOverlayProps) {
  const { segments } = getDayZones(date, prefs);
  const scale = hourHeight / 64;

  return (
    <View className="absolute inset-0">
      {segments.length === 0 ? (
        <View className="absolute inset-0 bg-muted/75" />
      ) : (
        nonWorkGaps(segments).map((gap) => (
          <View
            key={gap.topPx}
            className="absolute inset-x-0 bg-muted/55"
            style={{
              top: gap.topPx * scale,
              height: (gap.bottomPx - gap.topPx) * scale,
            }}
          />
        ))
      )}
    </View>
  );
}
