import { addDays, eachDayOfInterval, format, subDays } from "date-fns";
import {
  Dispatch,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { deleteData, getData } from "../../api";
import { Task, TasksResponse } from "../../types/tasks";
import { Separator } from "../ui/separator";
import { TaskCard } from "./views/card";
import { toast } from "sonner";

export function TaskView({
  selectedDate,
  deleteSchedule,
  openEditTaskDialog,
  setSelectedDate,
  loading,
  setLoading,
  tasks,
  setTasks,
}: {
  selectedDate: Date;
  deleteSchedule: (
    taskId: string,
    date: string,
    split: number
  ) => Promise<void>;
  openEditTaskDialog: (taskId: string) => void;
  setSelectedDate: (date: Date) => void;
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rangeStart, setRangeStart] = useState(() => subDays(selectedDate, 7));
  const [rangeEnd, setRangeEnd] = useState(() => addDays(selectedDate, 7));

  const range = useMemo(
    () => eachDayOfInterval({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd]
  );

  const fetchTasks = async (start: Date, end: Date) => {
    setLoading(true);
    try {
      const response = await getData<TasksResponse>(
        `/tasks?start=${format(start, "yyyy-MM-dd")}&end=${format(
          end,
          "yyyy-MM-dd"
        )}`
      );
      if (response.data) {
        const ids = tasks.map((t) => t.id);
        setTasks((prev: Task[]) => [
          ...prev.filter((t) => !ids.includes(t.id)),
          ...response.data,
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  const taskGroup = useMemo(() => {
    const dateMap = new Map<string, Map<string, Task>>();
    for (const task of tasks) {
      const schedules = task.schedules || [];
      for (const schedule of schedules) {
        if (!schedule.start || !schedule.end) continue;
        const scheduleDate = format(new Date(schedule.date), "yyyy-MM-dd");
        if (!dateMap.has(scheduleDate)) {
          dateMap.set(scheduleDate, new Map());
          const taskMap = dateMap.get(scheduleDate)!;
          taskMap.set(task.id, { ...task, schedules: [schedule] });
        } else {
          const tasksBucket = dateMap.get(scheduleDate)!;
          const taskData = tasksBucket.get(task.id);
          if (!taskData) {
            tasksBucket.set(task.id, { ...task, schedules: [schedule] });
          } else {
            tasksBucket.set(task.id, {
              ...task,
              schedules: [...(taskData.schedules ?? []), schedule],
            });
          }
        }
      }
    }
    return dateMap;
  }, [tasks]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    container.scrollTo({
      behavior: "smooth",
      top: (containerRect.y + containerRect.height) / 2,
    });
  }, []);

  const prevRangeRef = useRef<{ start: Date; end: Date } | null>(null);

  useEffect(() => {
    // Detect previous range
    const prev = prevRangeRef.current;

    // On first mount — fetch the initial range
    if (!prev) {
      prevRangeRef.current = { start: rangeStart, end: rangeEnd };
      fetchTasks(rangeStart, rangeEnd);
      return;
    }

    // On later updates — detect expansion and fetch only the new part
    if (rangeStart < prev.start) {
      fetchTasks(rangeStart, subDays(prev.start, 1)); // expanded upward
    }

    if (rangeEnd > prev.end) {
      fetchTasks(addDays(prev.end, 1), rangeEnd); // expanded downward
    }

    // Update reference
    prevRangeRef.current = { start: rangeStart, end: rangeEnd };
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading) return;
    const handleScroll = () => {
      if (loading) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      const atTop = scrollTop < 100;
      const atBottom = scrollTop + clientHeight > scrollHeight - 100;

      // Expand upward
      if (atTop) {
        setRangeStart((prev) => subDays(prev, 7));
        container.scrollTop = scrollTop + 100;
      }

      // Expand downward
      if (atBottom) {
        setRangeEnd((prev) => addDays(prev, 7));
      }

      // Update currently visible date
      const sections = container.querySelectorAll<HTMLElement>("section[id]");
      let closest: HTMLElement | null = null;
      let minDistance = Infinity;
      const containerRect = container.getBoundingClientRect();

      sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        const distance = Math.abs(rect.top - containerRect.top + 80);
        if (distance < minDistance) {
          minDistance = distance;
          closest = section;
        }
      });

      if (closest) {
        const date = new Date((closest as HTMLElement).id);

        if (date.toDateString() !== selectedDate.toDateString()) {
          setSelectedDate(date);
        }
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loading, selectedDate, setSelectedDate]);

  const deleteTask = async (taskId: string) => {
    setLoading(true);
    try {
      await deleteData(`/tasks/${taskId}`);
      toast.success("Delete task successfully");
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full px-4 sm:px-6 lg:px-8 relative overflow-y-auto bg-background"
    >
      {range.map((date) => (
        <DateSection
          key={format(date, "yyyy-MM-dd")}
          date={date}
          tasks={Array.from(
            taskGroup.get(format(date, "yyyy-MM-dd"))?.values() ?? []
          )}
          loading={loading}
          deleteSchedule={deleteSchedule}
          deleteTask={deleteTask}
          openEditDialog={openEditTaskDialog}
          setSelectedDate={setSelectedDate}
        />
      ))}
    </div>
  );
}

interface DateSectionProps {
  date: Date;
  tasks: Task[];
  loading?: boolean;
  setSelectedDate: (date: Date) => void;
  deleteSchedule: (taskId: string, date: string, split: number) => void;
  deleteTask: (taskId: string) => void;
  openEditDialog: (taskId: string) => void;
}

function DateSection({
  date,
  tasks,
  loading,
  setSelectedDate,
  deleteSchedule,
  deleteTask,
  openEditDialog,
}: DateSectionProps) {
  return (
    <section className="bg-background py-3" id={format(date, "yyyy-MM-dd")}>
      <a
        href={`#${format(date, "yyyy-MM-dd")}`}
        className="flex-1 cursor-pointer font-semibold"
        onClick={() => setSelectedDate(date)}
      >
        {format(date, "MMM d, yyyy")}
        <div className="text-muted-foreground font-normal text-sm">
          {format(date, "EEEE")}
        </div>
      </a>
      <Separator className="my-2" />
      <div className="flex overflow-x-auto items-baseline flex-nowrap gap-3">
        {tasks.map((t) => (
          <TaskCard
            loading={loading}
            key={t.id}
            task={t}
            deleteSchedule={deleteSchedule}
            deleteTask={deleteTask}
            openEditDialog={openEditDialog}
          />
        ))}
      </div>
    </section>
  );
}
