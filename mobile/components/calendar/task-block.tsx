import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { DAILY_HORIZON } from "@zenflow/core";
import { withOverlap } from "@zenflow/core";
import type { BlockLayout } from "@zenflow/core";
import type { DaySegment } from "@zenflow/shared";
import { toZonedTime } from "date-fns-tz";

const TAGS_MIN_DURATION = 45;

const TAG_TINTS = [
  "border-orange-400/40 bg-orange-100/15",
  "border-yellow-400/45 bg-yellow-100/15",
  "border-lime-400/55 bg-lime-100/25",
];

function tagTint(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_TINTS[h % TAG_TINTS.length];
}

function minutesOfDayLocal(iso: string, tz: string) {
  const d = toZonedTime(new Date(iso), tz);
  return d.getHours() * 60 + d.getMinutes();
}

function fmt(iso: string, tz: string) {
  return toZonedTime(new Date(iso), tz).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface TaskBlockProps {
  segment: DaySegment;
  layout: BlockLayout;
  tz: string;
  totalHeight: number;
  leftOffset: number;
  blockWidth: number;
}

export function TaskBlock({
  segment,
  layout,
  tz,
  totalHeight,
  leftOffset,
  blockWidth,
}: TaskBlockProps) {
  const startMin = minutesOfDayLocal(segment.start, tz);
  const rawEndMin = minutesOfDayLocal(segment.end, tz);
  const endMin = segment.continues || rawEndMin === 0 ? DAILY_HORIZON : rawEndMin;
  const duration = endMin - startMin;
  const isCompact = duration < 30;
  const showTags = duration > TAGS_MIN_DURATION && segment.tags.length > 0;

  const state = withOverlap(segment.state, layout.conflict);
  const isCompleted = segment.status === "DONE";
  const isSplit = Boolean(segment.continued);

  const top = (startMin / DAILY_HORIZON) * totalHeight;
  const height = Math.max((duration / DAILY_HORIZON) * totalHeight, 20);

  const borderColor =
    state === "overdue"
      ? "#f43f5e"
      : state === "conflict"
        ? "#f59e0b"
        : state === "completed"
          ? "#10b981"
          : "rgb(var(--primary))";

  const bgColor =
    state === "overdue"
      ? "rgba(244,63,94,0.08)"
      : state === "conflict"
        ? "rgba(245,158,11,0.08)"
        : state === "completed"
          ? "rgba(var(--muted) / 0.6)"
          : "rgba(var(--card) / 0.9)";

  return (
    <View
      className="absolute z-10 px-0.5"
      style={{
        top,
        left: leftOffset,
        width: blockWidth,
        height,
      }}
    >
      <View
        className={cn(
          "flex overflow-hidden rounded border shadow-sm",
          isCompact ? "flex-row items-center gap-1.5 px-2" : "flex-col py-1 px-2",
          segment.continues && "rounded-b-none",
          segment.continued && "rounded-t-none border-t-0 border-dashed",
        )}
        style={{
          borderLeftWidth: 4,
          borderLeftColor: borderColor,
          backgroundColor: bgColor,
        }}
      >
        {isCompact ? (
          <>
            <View className="min-w-0 flex-1 flex-row items-center gap-1">
              {segment.continued && (
                <Text className="text-[10px] text-muted-foreground">↳</Text>
              )}
              <Text
                className={cn(
                  "flex-1 truncate text-[10px] font-semibold",
                  isCompleted && "line-through",
                )}
              >
                {segment.title}
              </Text>
            </View>
            <Text className="shrink-0 font-mono text-[9px] text-muted-foreground">
              {segment.continued
                ? `ends ${fmt(segment.taskEnd, tz)}`
                : fmt(segment.taskStart, tz)}
            </Text>
          </>
        ) : (
          <>
            <View className="flex-row items-center gap-1">
              {segment.continued && (
                <Text className="text-[10px] text-muted-foreground">↳</Text>
              )}
              <Text
                className={cn(
                  "flex-1 truncate text-xs font-semibold",
                  isCompleted && "line-through",
                )}
              >
                {segment.title}
              </Text>
            </View>
            <Text className="font-mono text-[10px] text-muted-foreground">
              {segment.continued
                ? `cont. → ${fmt(segment.taskEnd, tz)}`
                : segment.continues
                  ? `${fmt(segment.taskStart, tz)} → next day`
                  : `${fmt(segment.taskStart, tz)} – ${fmt(segment.taskEnd, tz)}`}
            </Text>
            {showTags && (
              <View className="mt-0.5 flex-row flex-wrap gap-1 overflow-hidden">
                {segment.tags.slice(0, 3).map((t) => (
                  <View
                    key={t}
                    className={cn(
                      "rounded border px-1.5 py-0.5",
                      tagTint(t),
                    )}
                  >
                    <Text className="text-[9px] font-medium">{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}
