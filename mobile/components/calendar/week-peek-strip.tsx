import { useLanguage } from "@/hooks/use-language";
import { DAY_MINUTES, type PeekBlock } from "@/lib/peek";
import { SESSION_TONES, hexAlpha } from "@zenflow/core";
import { useState } from "react";
import { View } from "react-native";

/** Width of the decorative "next day" peek strip on each page's right edge
 * (mirrors mockups/week-view.html's `w-3.5` affordance). */
export const PEEK_STRIP_W = 14;

/** Block fill per task state, matching the day grid's state treatment. */
export const PEEK_BLOCK_COLORS: Record<PeekBlock["state"], string> = {
  fluid: hexAlpha(SESSION_TONES.task.base, 0.6),
  conflict: hexAlpha(SESSION_TONES.conflict.base, 0.7),
  assignment: hexAlpha(SESSION_TONES.assignment.base, 0.6),
  exam: hexAlpha(SESSION_TONES.exam.base, 0.6),
  lecture: hexAlpha(SESSION_TONES.lecture.base, 0.6),
  dnd: hexAlpha(SESSION_TONES.dnd.base, 0.5),
};

/** Right-edge sliver showing the next day's tasks as mini blocks, positioned
 * by wall-clock time and colored by task state. */
export function PeekStrip({ blocks }: { blocks: PeekBlock[] }) {
  useLanguage();
  const [height, setHeight] = useState(0);

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      className="absolute top-0 bottom-0 z-[6] overflow-hidden border-l border-border bg-card"
      style={{
        width: PEEK_STRIP_W,
        right: 0,
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: -2, height: 0 },
        elevation: 2,
      }}
    >
      {height > 0 &&
        blocks.map((block) => (
          <View
            key={block.key}
            className="absolute rounded"
            style={{
              left: 3,
              width: 8,
              top: (block.startMin / DAY_MINUTES) * height,
              height: Math.max(2, (block.durationMin / DAY_MINUTES) * height),
              backgroundColor: PEEK_BLOCK_COLORS[block.state],
            }}
          />
        ))}
    </View>
  );
}
