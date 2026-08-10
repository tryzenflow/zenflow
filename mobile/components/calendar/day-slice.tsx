import { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import { Text } from "@/components/ui/text";
import { eventsForDay, getOverlapLayout, tasksToBlocks } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { format } from "date-fns";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { TimeGutter } from "./time-gutter";
import { TaskBlock } from "./task-block";

const GUTTER_WIDTH = 64;
const HOUR_HEIGHT = 64;
const SCOPE_FROM_MIN = 0;
const SCOPE_TO_MIN = 240;

interface DaySliceProps {
  date: Date;
  tz: string;
  tails: Task[];
  onCollapse: () => void;
}

export function DaySlice({ date, tz, tails, onCollapse }: DaySliceProps) {
  const { width: screenWidth } = useWindowDimensions();
  const contentWidth = screenWidth - GUTTER_WIDTH;

  const segments = useMemo(() => {
    const blocks = tasksToBlocks(tails);
    return eventsForDay(blocks, date, tz).filter((s) => s.continued);
  }, [tails, date, tz]);

  const layout = useMemo(() => getOverlapLayout(segments), [segments]);

  const collapseGesture = Gesture.Pan()
    .activeOffsetY([-24, 24])
    .onEnd((e) => {
      if (Math.abs(e.translationY) > 80) runOnJS(onCollapse)();
    });

  const scopeHeight = ((SCOPE_TO_MIN - SCOPE_FROM_MIN) / 60) * HOUR_HEIGHT;
  const scaleHeight = 24 * HOUR_HEIGHT;
  const hourLines = [0, 1, 2, 3, 4];

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-4 pt-3 pb-2">
        <View className="min-w-0 flex-1">
          <Text className="text-xl font-bold tracking-tight">
            {format(date, "EEE, MMM d")}
          </Text>
          <Text className="mt-px text-xs font-medium text-muted-foreground">
            Continues from last night
          </Text>
        </View>
      </View>

      <GestureDetector gesture={collapseGesture}>
        <View className="flex-1">
          <View className="relative" style={{ height: scopeHeight }}>
            <TimeGutter
              hourHeight={HOUR_HEIGHT}
              fromHour={SCOPE_FROM_MIN / 60}
              toHour={SCOPE_TO_MIN / 60}
              showZeroLabel
            />
            <View
              className="absolute top-0 bottom-0 overflow-hidden bg-card"
              style={{ left: GUTTER_WIDTH, right: 0 }}
            >
              <View className="absolute inset-0 bg-muted/55" />
              {hourLines.map((hour) => (
                <View
                  key={hour}
                  className="absolute left-0 right-0 bg-border/50"
                  style={{ top: hour * HOUR_HEIGHT, height: 1 }}
                />
              ))}
              {segments.map((segment) => {
                const blockLayout = layout.get(segment.segmentId) ?? {
                  column: 0,
                  columns: 1,
                  conflict: false,
                };
                const blockWidth = contentWidth / blockLayout.columns;
                const leftOffset = blockLayout.column * blockWidth;
                return (
                  <TaskBlock
                    key={segment.segmentId}
                    segment={segment}
                    layout={blockLayout}
                    tz={tz}
                    totalHeight={scaleHeight}
                    leftOffset={leftOffset}
                    blockWidth={blockWidth}
                  />
                );
              })}
            </View>
          </View>

          <View className="flex-1 items-center justify-center px-8">
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}
