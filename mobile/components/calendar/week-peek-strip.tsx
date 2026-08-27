import { useState } from "react";
import { View } from "react-native";
import { DAY_MINUTES, type PeekBlock } from "@/lib/peek";

/** Width of the decorative "next day" peek strip on each page's right edge
 * (mirrors mockups/week-view.html's `w-3.5` affordance). */
export const PEEK_STRIP_W = 14;

/** Block fill per task state, matching the day grid's state treatment. */
export const PEEK_BLOCK_COLORS: Record<PeekBlock["state"], string> = {
  fluid: `rgba(255, 142, 62, 0.55)`,
  overdue: "rgba(244, 63, 94, 0.6)",
  conflict: "rgba(245, 158, 11, 0.6)",
  completed: "rgba(16, 185, 129, 0.45)",
};

/** Right-edge sliver showing the next day's tasks as mini blocks, positioned
 * by wall-clock time and colored by task state. */
export function PeekStrip({ blocks }: { blocks: PeekBlock[] }) {
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