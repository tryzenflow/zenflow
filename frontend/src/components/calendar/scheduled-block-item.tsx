import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import { TASK_CARD_CLASSES } from "@/lib/task-card";
import { Event } from "@/types/schedule";
import { DAILY_HORIZON } from "@/utils/constants";
import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { toZonedTime } from "date-fns-tz";
import { Lock } from "lucide-react";

function minutesOfDay(iso: string, tz: string) {
  const d = toZonedTime(new Date(iso), tz);
  return d.getHours() * 60 + d.getMinutes();
}

function fmt(iso: string, tz: string) {
  return toZonedTime(new Date(iso), tz).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Notify the layout to open the task detail panel for this block's task. */
function openTask(taskId: string) {
  window.dispatchEvent(new CustomEvent("zenflow:open-task", { detail: taskId }));
}

export function ScheduledBlockItem({
  block,
  spacing,
}: {
  block: Event;
  spacing: number;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const startMin = minutesOfDay(block.start, tz);
  const endMin = minutesOfDay(block.end, tz);
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: block.id,
  });

  return (
    <div
      className="absolute inset-x-0 z-10 px-0.5"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => openTask(block.taskId)}
      style={{
        top: `${(startMin / DAILY_HORIZON) * 100}%`,
        left: `${spacing * 16}px`,
        height: `${((endMin - startMin) / DAILY_HORIZON) * 100}%`,
        transform: CSS.Translate.toString(transform),
      }}
    >
      <div
        className={cn(
          "flex h-full cursor-grab flex-col overflow-hidden rounded border border-l-4 px-2 py-1 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing",
          TASK_CARD_CLASSES[block.state],
        )}
      >
        <div className="flex items-center gap-1">
          {block.fixed && (
            <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              "truncate text-xs font-semibold",
              block.state === "completed" && "line-through",
            )}
          >
            {block.title}
          </span>
        </div>
        <span className="font-mono text-[10px]">
          {fmt(block.start, tz)} – {fmt(block.end, tz)}
        </span>
        {block.tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1 overflow-hidden">
            {block.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-medium"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
