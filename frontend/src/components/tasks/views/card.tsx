import { Task } from "@/types/tasks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGradientIndex } from "./gradients";
import {
  ChevronDown,
  Clock,
  ClockArrowDown,
  ClockArrowUp,
  Edit,
  Split,
  Trash,
  X,
} from "lucide-react";
import { formatMinutes, minutesToTime } from "@/utils/time";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";

interface TaskCardProps {
  task: Task;
  loading?: boolean;
  deleteSchedule: (taskId: string, date: string, split: number) => void;
  deleteTask?: (taskId: string) => void;
  openEditDialog?: (taskId: string) => void;
}

const priorityMap = {
  3: { className: "bg-blue-500", text: "Low" },
  2: { className: "bg-yellow-500", text: "Medium" },
  1: { className: "bg-red-500", text: "High" },
};

const focusMap = {
  1: { className: "bg-green-500", text: "Low" },
  2: { className: "bg-yellow-500", text: "Medium" },
  3: { className: "bg-red-500", text: "High" },
};

export function TaskCard({
  task,
  loading,
  openEditDialog,
  deleteTask,
  deleteSchedule,
}: TaskCardProps) {
  const [open, setOpen] = useState(false);
  const firstImageOrVideoUrl = useMemo(() => {
    // find first occurrence of img or video tag and extract src
    const imgRegex = /<img[^>]+src="([^">]+)"/i;
    const videoRegex = /<video[^>]+src="([^">]+)"/i;
    const imgMatch = task.note?.match(imgRegex);
    if (imgMatch && imgMatch[1]) {
      return { match: "image", url: imgMatch[1] };
    }
    const videoMatch = task.note?.match(videoRegex);
    if (videoMatch && videoMatch[1]) {
      return { match: "video", url: videoMatch[1] };
    }
  }, [task.note]);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    videoRef.current?.play().catch(() => {});
  }, [task.id]);

  return (
    <Card className="py-0 min-w-72 gap-3">
      <div
        style={{
          background: firstImageOrVideoUrl?.match
            ? "none"
            : getGradientIndex(task.id),
        }}
        className="rounded-t-xl relative aspect-video"
      >
        {task.note &&
          (firstImageOrVideoUrl?.match === "image" ? (
            <img
              src={firstImageOrVideoUrl.url}
              alt="Task Media"
              className="w-72 h-40 object-cover rounded-t-xl"
            />
          ) : firstImageOrVideoUrl?.match === "video" ? (
            <video
              src={firstImageOrVideoUrl.url}
              autoPlay
              playsInline
              preload="auto"
              ref={videoRef}
              loop
              muted
              className="w-72 h-40 object-cover rounded-t-xl"
              controls={false}
            />
          ) : null)}
        <div className="flex gap-x-3 absolute z-10 top-4 right-4">
          {openEditDialog && (
            <Button
              variant="ghost"
              onClick={() => openEditDialog(task.id)}
              className="bg-white/50 hover:bg-white/80 backdrop-blur-lg rounded-full"
              disabled={loading}
              size="icon-sm"
            >
              <Edit className="size-4" />
            </Button>
          )}
          {deleteTask && (
            <Button
              variant="destructive"
              disabled={loading}
              onClick={() => deleteTask(task.id)}
              className="bg-destructive/50 hover:bg-destructive/80 backdrop-blur-lg rounded-full"
              size="icon-sm"
            >
              <Trash className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <CardHeader className="px-4">
        <CardTitle>{task.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid px-4 py-0 pb-4 gap-y-2">
        <div className="flex items-center gap-x-2">
          <div className="flex items-center gap-x-2 text-muted-foreground text-sm">
            <Clock className="size-4" />
            <span>{formatMinutes(task.duration)}</span>
          </div>
          <div className="flex items-center gap-x-2 text-muted-foreground text-sm">
            <Split className="size-4" />
            <span>Max {task.maxSplits} split(s)</span>
          </div>
        </div>
        <div className="flex items-center gap-x-2">
          {task.earliestStart !== undefined && (
            <div className="flex items-center gap-x-2 text-muted-foreground text-sm">
              <ClockArrowUp className="size-4" />
              <span>{minutesToTime(task.earliestStart)}</span>
            </div>
          )}
          {task.latestEnd && (
            <div className="flex items-center gap-x-2 text-muted-foreground text-sm">
              <ClockArrowDown className="size-4" />
              <span>{minutesToTime(task.latestEnd)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-x-3">
          <div className="flex items-center gap-x-1 font-medium text-sm">
            <div
              className={cn(
                priorityMap[task.priority].className,
                "rounded-sm size-4",
              )}
            />
            <span>{priorityMap[task.priority].text} Priority</span>
          </div>
          <div className="flex items-center gap-x-1 font-medium text-sm">
            <div
              className={cn(
                focusMap[task.energy].className,
                "rounded-full size-4",
              )}
            />
            <span>{focusMap[task.energy].text} Focus</span>
          </div>
        </div>
        {(task.schedules ?? []).length > 0 && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button
                size="sm"
                className="-mx-2.5 w-fit gap-x-3 items-center justify-between"
                variant="ghost"
              >
                <span>{task.schedules?.length} schedule(s) on this day</span>
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-y-2 mt-3">
              {task.schedules?.map((s) => (
                <div
                  key={`${format(s.date, "yyyy-MM-dd")}-${s.splitIndex}}`}
                  className="flex justify-between items-center"
                >
                  <span className="text-foreground text-sm font-medium">
                    {format(s.start!, "hh:mm a")} -{" "}
                    {format(s.end!, "hh:mm a")}{" "}
                  </span>
                  <X
                    onClick={() =>
                      deleteSchedule(task.id, s.date, s.splitIndex)
                    }
                    className="size-4"
                  />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
