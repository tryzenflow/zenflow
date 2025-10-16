import { EditIcon, TrashIcon } from "lucide-react";
import { Schedule } from "../../types/schedule";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";

const focusColorMap = {
  1: {
    bg: "bg-green-100/70 dark:bg-green-900/40",
    text: "text-green-800 dark:text-green-300",
    border: "border-green-500",
    hover: "hover:bg-green-200/70 dark:hover:bg-green-800/40",
  },
  2: {
    bg: "bg-yellow-100/70 dark:bg-yellow-900/40",
    text: "text-yellow-800 dark:text-yellow-300",
    border: "border-yellow-500",
    hover: "hover:bg-yellow-200/70 dark:hover:bg-yellow-800/40",
  },
  3: {
    bg: "bg-red-100/70 dark:bg-red-900/40",
    text: "text-red-800 dark:text-red-300",
    border: "border-red-500",
    hover: "hover:bg-red-200/70 dark:hover:bg-red-800/40",
  },
};

export const ScheduleItem = ({
  schedule,
  deleteSchedule,
  openEditTaskDialog,
}: {
  schedule: Schedule;
  deleteSchedule: (taskId: string, date: string, split: number) => void;
  openEditTaskDialog: (taskId: string) => void;
}) => {
  const { task, start, end, split, date } = schedule;

  const colors = focusColorMap[task.focus] || focusColorMap[1];

  const startDate = new Date(start!);
  const endDate = new Date(end!);
  const startHour = startDate.getHours();
  const startMinute = startDate.getMinutes();
  const endHour = endDate.getHours();
  const endMinute = endDate.getMinutes();

  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const durationMinutes = endMinutes - startMinutes;

  const topPosition = startMinutes;
  const height = durationMinutes;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`absolute left-12 w-[calc(100%-4rem)] rounded-sm p-1 text-xs border-l-3 shadow-sm transition-all ${colors.bg} ${colors.text} ${colors.border} ${colors.hover}`}
          style={{
            top: `${topPosition}px`,
            height: `${height}px`,
            minHeight: "2rem", // Minimum height for visibility
            zIndex: 10,
            marginLeft: "1rem",
            overflow: "hidden",
          }}
        >
          <div className="font-semibold">{task.title}</div>
          {durationMinutes >= 30 && (
            <div className="text-[10px] opacity-80">
              {startDate.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              -{" "}
              {endDate.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => openEditTaskDialog(task.id)}>
            <EditIcon className="size-4" />
            Edit task
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => deleteSchedule(task.id, date, split)}
            variant="destructive"
          >
            <TrashIcon className="size-4" />
            Delete schedule
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
};
