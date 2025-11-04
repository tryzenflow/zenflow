import { EditIcon, TrashIcon } from "lucide-react";
import { Schedule } from "../../types/schedule";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../ui/hover-card";
import { TaskCard } from "../tasks/views/card";
import { useEffect, useRef, useState } from "react";
import { Task, TaskResponse } from "../../types/tasks";
import { getData } from "../../api";
import { minutesToTime, militaryTimeToMinutes } from "../../utils/prefs";
import { snapToFive } from "../../utils/snap";
import { format } from "date-fns";

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

const BOUNDARY = 5; // Pixel threshold for resize areas (top and bottom)
const MIN_BLOCK_MINUTES = 5;
const PIXELS_PER_MINUTE = 1; // 1px = 1 minute (Vertical scale)
const CALENDAR_TIME_COLUMN_WIDTH_PX = 48; // Time column offset (w-12 or 3rem)

export const ScheduleItem = ({
  schedule,
  deleteSchedule,
  openEditTaskDialog,
  columnIndex = 0,
  totalColumns = 1,
  isOverlapping = false,
  updateScheduleTime,
  dayIndex = 0,
  isWeekView = false,
}: {
  schedule: Schedule;
  deleteSchedule: (taskId: string, date: string, split: number) => void;
  openEditTaskDialog: (taskId: string) => void;
  columnIndex?: number;
  totalColumns?: number;
  isOverlapping?: boolean;
  updateScheduleTime: (
    taskId: string,
    date: string,
    split: number,
    newStart: number,
    newEnd: number
  ) => void;
  dayIndex?: number;
  isWeekView?: boolean;
}) => {
  const { task, start, end, split, date } = schedule;

  const colors = focusColorMap[task.focus] || focusColorMap[1];

  const startDate = new Date(start!);
  const endDate = new Date(end!);

  // Calculate current minutes from start of day
  const currentStartMinutes = militaryTimeToMinutes(format(startDate, "HH:mm"));
  const currentEndMinutes = militaryTimeToMinutes(format(endDate, "HH:mm"));
  const durationMinutes = currentEndMinutes - currentStartMinutes;

  const topPosition = currentStartMinutes * PIXELS_PER_MINUTE; // 1px per minute
  const height = durationMinutes * PIXELS_PER_MINUTE;

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<Task | null>(null);
  const itemRef = useRef<HTMLDivElement>(null); // Ref for the main event block

  // --- Drag/Resize State (Adapted from FocusBlock) ---
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<
    "move" | "resizeTop" | "resizeBottom" | null
  >(null);
  const [dragStartY, setDragStartY] = useState<number | null>(null);
  const [initialStartMinutes, setInitialStartMinutes] =
    useState(currentStartMinutes);
  const [initialEndMinutes, setInitialEndMinutes] = useState(currentEndMinutes);

  useEffect(() => {
    if (!selectedTaskId) setTaskDetail(null);
    else
      getData<TaskResponse>(`/tasks/${selectedTaskId}`).then((res) =>
        setTaskDetail(res.data)
      );
  }, [selectedTaskId]);

  // ---- Handle mouse down (Adapted to vertical) ----
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!itemRef.current) return;

    const rect = itemRef.current.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    if (offsetY < BOUNDARY) {
      setDragType("resizeTop");
    } else if (offsetY > rect.height - BOUNDARY) {
      setDragType("resizeBottom");
    } else {
      setDragType("move");
    }

    setIsDragging(true);
    setDragStartY(e.clientY);
    setInitialStartMinutes(currentStartMinutes);
    setInitialEndMinutes(currentEndMinutes);

    // Set a class to prevent text selection during drag
    document.body.classList.add("select-none");
    e.preventDefault();
  };

  // ---- Mouse Move (Adapted to vertical and time calculation) ----
  const onMouseMove = (e: MouseEvent) => {
    e.stopPropagation();
    if (!isDragging || dragStartY === null || !dragType) return;

    // Delta in pixels, which is Delta in minutes (PIXELS_PER_MINUTE = 1)
    const deltaMinutes = e.clientY - dragStartY;

    // --- MOVE LOGIC ---
    if (dragType === "move") {
      const newStartMinutes = initialStartMinutes + deltaMinutes;
      const newEndMinutes = initialEndMinutes + deltaMinutes;

      const snappedStart = snapToFive(newStartMinutes);
      const snappedEnd = snapToFive(newEndMinutes);

      // Simple check to prevent dragging off the 24-hour clock (0 to 1440 minutes)
      if (snappedStart >= 0 && snappedEnd <= 1440) {
        // Optimistic update using onBlockChange pattern (calls updateScheduleTime)
        updateTimeChange(snappedStart, snappedEnd);
      }

      // --- RESIZE TOP LOGIC ---
    } else if (dragType === "resizeTop") {
      const newStartMinutes = initialStartMinutes + deltaMinutes;

      const snappedStart = snapToFive(
        Math.min(newStartMinutes, initialEndMinutes - MIN_BLOCK_MINUTES)
      );

      updateTimeChange(snappedStart, initialEndMinutes);

      // --- RESIZE BOTTOM LOGIC ---
    } else if (dragType === "resizeBottom") {
      const newEndMinutes = initialEndMinutes + deltaMinutes;

      const snappedEnd = snapToFive(
        Math.max(newEndMinutes, initialStartMinutes + MIN_BLOCK_MINUTES)
      );

      updateTimeChange(initialStartMinutes, snappedEnd);
    }
  };

  // Utility to finalize and call the parent update function
  const updateTimeChange = (newStartMins: number, newEndMins: number) => {
    updateScheduleTime(task.id, date, split, newStartMins, newEndMins);
  };

  // ---- Handle mouse up ----
  const onMouseUp = (e: MouseEvent) => {
    e.stopPropagation();
    setIsDragging(false);
    setDragType(null);
    setDragStartY(null);
    document.body.classList.remove("select-none");
  };

  // ---- Cursor change on hover (Vertical adaptation) ----
  const onMouseMoveOver = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!itemRef.current || isDragging) return;
    const rect = itemRef.current.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    if (offsetY < BOUNDARY || offsetY > rect.height - BOUNDARY) {
      itemRef.current.style.cursor = "ns-resize"; // Vertical resize
    } else {
      itemRef.current.style.cursor = "grab"; // Drag
    }
  };

  // ---- Global listeners during drag (FocusBlock style) ----
  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    } else {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    isDragging,
    dragType,
    dragStartY,
    initialStartMinutes,
    initialEndMinutes,
    schedule,
  ]);

  // --- Styling ---
  const isInteractionActive = isDragging; // Use isDragging for global interaction state

  // Calculate positioning based on view type
  const getPositionStyles = () => {
    if (isWeekView) {
      // Week view: position within specific day column
      const dayColumnWidth = `calc((100% - ${CALENDAR_TIME_COLUMN_WIDTH_PX}px) / 7)`;
      const dayColumnOffset = `calc(${CALENDAR_TIME_COLUMN_WIDTH_PX}px + ${dayColumnWidth} * ${dayIndex})`;

      return {
        left: dayColumnOffset,
        width: `calc(${dayColumnWidth} / ${totalColumns})`,
        marginLeft: `calc(${dayColumnWidth} / ${totalColumns} * ${columnIndex})`,
      };
    } else {
      // Day view: original positioning
      return {
        left: `${CALENDAR_TIME_COLUMN_WIDTH_PX}px`,
        width: `calc((100% - ${
          CALENDAR_TIME_COLUMN_WIDTH_PX + 5
        }px) / ${totalColumns})`,
        marginLeft: `calc((100% - ${
          CALENDAR_TIME_COLUMN_WIDTH_PX + 5
        }px) / ${totalColumns} * ${columnIndex} + 5px)`,
      };
    }
  };

  const dynamicStyles: React.CSSProperties = {
    top: `${topPosition}px`,
    height: `${height}px`,
    minHeight: "2rem",
    ...getPositionStyles(),
    zIndex: isInteractionActive ? 30 : isOverlapping ? 20 + columnIndex : 10,
    overflow: "hidden",
  };

  return (
    <ContextMenu>
      <HoverCard
        open={!!selectedTaskId && !isInteractionActive} // Prevent dropdown during interaction
        onOpenChange={() =>
          setSelectedTaskId((prev) => (prev ? null : task.id))
        }
      >
        <ContextMenuTrigger asChild>
          <HoverCardTrigger asChild>
            <div
              ref={itemRef}
              className={`absolute rounded-sm border-l-2 shadow-md transition-all ${
                isWeekView ? "text-[10px]" : "text-xs"
              } ${colors.bg} ${colors.text} ${colors.border} ${colors.hover}`}
              style={dynamicStyles}
              onMouseDown={onMouseDown} // 👈 Use combined drag/resize handler
              onMouseMove={onMouseMoveOver} // 👈 Use combined cursor handler
            >
              {/* CONTENT WRAPPER */}
              <div className={`relative h-full w-full px-2 pt-1`}>
                <div
                  className={`font-semibold ${isWeekView ? "truncate" : ""}`}
                >
                  {task.title}
                </div>
                {durationMinutes >= 30 && (
                  <div className="text-[10px] opacity-80">
                    {minutesToTime(currentStartMinutes)} -{" "}
                    {minutesToTime(currentEndMinutes)}
                  </div>
                )}
              </div>
            </div>
          </HoverCardTrigger>
        </ContextMenuTrigger>
        <HoverCardContent asChild={!!taskDetail}>
          {taskDetail ? (
            <TaskCard task={taskDetail} deleteSchedule={deleteSchedule} />
          ) : (
            <div className="text-muted-foreground">No data available</div>
          )}
        </HoverCardContent>
      </HoverCard>
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
