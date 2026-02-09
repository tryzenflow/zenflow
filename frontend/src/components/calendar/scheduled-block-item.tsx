import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import { Event } from "@/types/schedule";
import { DAILY_HORIZON } from "@/utils/constants";
import { getEnergyStyle } from "@/utils/energy";
import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { fromZonedTime } from "date-fns-tz";

function getBlockStyle(block: Event, spacing: number, timezone: string) {
  const start = fromZonedTime(block.start, timezone);
  const end = fromZonedTime(block.end, timezone);

  const startFromMidnight = start.getHours() * 60 + start.getMinutes();
  const endFromMidnight = end.getHours() * 60 + end.getMinutes();

  return {
    top: `${(startFromMidnight / DAILY_HORIZON) * 100}%`,
    left: `${spacing * 16}px`,
    height: `${((endFromMidnight - startFromMidnight) / DAILY_HORIZON) * 100}%`,
  };
}

export function ScheduledBlockItem({
  block,
  spacing,
}: {
  block: Event;
  spacing: number;
}) {
  const user = useUserStore((state) => state.user);
  const { backgroundColor, textColor } = getEnergyStyle(block.task.energy);
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: block.id,
  });
  const style = {
    // Outputs `translate3d(x, y, 0)`
    transform: CSS.Translate.toString(transform),
  };
  return (
    <div
      className="absolute inset-x-0 px-0.5 z-10"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        ...getBlockStyle(block, spacing, user?.timezone || "UTC"),
        ...style,
      }}
    >
      <div
        className={cn(
          "flex h-full flex-col overflow-hidden transition-colors rounded px-2 py-1 text-xs",
          backgroundColor,
          textColor,
        )}
      >
        <div className="truncate font-medium">{block.task.title}</div>
        <div className="truncate text-[10px] opacity-70">
          {new Date(block.start).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
          {" – "}
          {new Date(block.end).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
