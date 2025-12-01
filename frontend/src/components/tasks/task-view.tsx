import { addDays, eachDayOfInterval, format, subDays } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { getData } from "../../api";
import { Task, TasksResponse } from "../../types/tasks";
import { Separator } from "../ui/separator";
import { TaskCard } from "./views/card";
import { toast } from "sonner";
import { deleteTask } from "../../utils/tasks";
import { useUserStore } from "@/hooks/use-user-store";
import { Schedule } from "@/types/schedule";

export function TaskView({
  selectedDate,
  deleteSchedule,
  openEditTaskDialog,
  setSelectedDate,
  loading,
  setLoading,
  // REMOVED: tasks, setTasks props
  taskViewRefetchTrigger, // NEW PROP
}: {
  selectedDate: Date;
  deleteSchedule: (
    taskId: string,
    date: string,
    split: number,
  ) => Promise<void>;
  openEditTaskDialog: (taskId: string) => void;
  setSelectedDate: (date: Date) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  // NEW: Refetch trigger from ViewLayout
  taskViewRefetchTrigger: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const user = useUserStore((state) => state.user);

  // NEW: Local state for tasks
  const [tasks, setTasks] = useState<Task[]>([]);

  // Cache key to force remount/re-initialization when ViewLayout triggers a refetch
  const [taskCacheKey, setTaskCacheKey] = useState(taskViewRefetchTrigger);

  // When the trigger changes, reset all TaskView state variables
  useEffect(() => {
    if (taskViewRefetchTrigger !== taskCacheKey) {
      setTasks([]); // Crucial: Clear tasks to prevent appending to old data
      setRangeStart(subDays(selectedDate, 7));
      setRangeEnd(addDays(selectedDate, 7));
      prevRangeRef.current = null; // Clear previous range ref
      setTaskCacheKey(taskViewRefetchTrigger); // Update key to acknowledge reset
    }
  }, [taskViewRefetchTrigger, taskCacheKey, selectedDate]);

  const [rangeStart, setRangeStart] = useState(() => subDays(selectedDate, 7));
  const [rangeEnd, setRangeEnd] = useState(() => addDays(selectedDate, 7));

  const range = useMemo(
    () => eachDayOfInterval({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd],
  );

  // ...existing code...
  const fetchTasks = async (start: Date, end: Date) => {
    setLoading(true);
    try {
      const response = await getData<TasksResponse>(
        `/tasks?start=${format(start, "yyyy-MM-dd")}&end=${format(
          end,
          "yyyy-MM-dd",
        )}`,
      );
      if (response.data) {
        // If backend returned schedule-level rows (each row has 'task'), convert to tasks
        let responseTasks: Task[] = [];

        // Detect schedule-row shape: first element has 'task' property
        if (
          Array.isArray(response.data) &&
          response.data.length > 0 &&
          "task" in (response.data as any)[0]
        ) {
          // response.data is schedule rows -> group them into tasks
          const rows = response.data as any[];
          const map = new Map<string, Task>();
          for (const row of rows) {
            const taskObj = row.task as {
              id: string;
              title: string;
              focus: number;
              duration: number;
            };
            if (!taskObj || !taskObj.id) continue;

            const schedule: Schedule = {
              date: row.date,
              start: row.start ?? null,
              end: row.end ?? null,
              split: row.split ?? 0,
              task: {
                id: taskObj.id,
                title: taskObj.title,
                focus: taskObj.focus as 1 | 2 | 3,
                duration: taskObj.duration,
              },
            };

            const existing = map.get(taskObj.id);
            if (!existing) {
              map.set(taskObj.id, {
                id: taskObj.id,
                title: taskObj.title,
                focus: taskObj.focus,
                duration: taskObj.duration,
                // other Task fields that may be used elsewhere can be added as needed
                schedules: [schedule],
              } as Task);
            } else {
              existing.schedules = [...(existing.schedules ?? []), schedule];
            }
          }
          responseTasks = Array.from(map.values());
        } else {
          // Assume backend returned tasks in the task-centered shape
          responseTasks = response.data as Task[];
        }

        // Robust deduplication: dedupe schedules by id (if present) or by date+split
        const dedupeSchedules = (schedules: Schedule[] = []) => {
          const map = new Map<string, Schedule>();
          for (const s of schedules) {
            const dateKey =
              s?.date != null ? new Date(s.date).toISOString() : "nodate";
            const key = `${dateKey}|${s?.split ?? 0}`;
            if (!map.has(key)) map.set(key, s);
          }
          return Array.from(map.values());
        };

        setTasks((prev) => {
          const existingTasksMap = new Map(prev.map((t) => [t.id, t]));

          for (const newTask of responseTasks) {
            const existing = existingTasksMap.get(newTask.id);
            if (!existing) {
              // ensure schedules are unique on first insert
              existingTasksMap.set(newTask.id, {
                ...newTask,
                schedules: dedupeSchedules(newTask.schedules),
              });
            } else {
              // combine schedules and dedupe by schedule key
              const combined = [
                ...(existing.schedules || []),
                ...(newTask.schedules || []),
              ];
              existingTasksMap.set(newTask.id, {
                ...existing,
                // prefer latest task fields from newTask, but keep deduped schedules
                ...newTask,
                schedules: dedupeSchedules(combined),
              });
            }
          }

          return Array.from(existingTasksMap.values());
        });
      }
    } catch (error) {
      toast.error("Failed to load tasks: " + (error as any));
    } finally {
      setLoading(false);
    }
  };
  // ...existing code...

  const taskGroup = useMemo(() => {
    // This grouping logic is still complex, but it works on the deduped tasks array
    const dateMap = new Map<string, Map<string, Task>>();
    for (const task of tasks) {
      const schedules = task.schedules || [];
      for (const schedule of schedules) {
        if (!schedule.start || !schedule.end) continue;
        const scheduleDate = format(new Date(schedule.date), "yyyy-MM-dd");
        if (!dateMap.has(scheduleDate)) {
          dateMap.set(scheduleDate, new Map());
        }

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
    return dateMap;
  }, [tasks]);

  const prevRangeRef = useRef<{ start: Date; end: Date } | null>(null);

  useEffect(() => {
    if (taskCacheKey !== taskViewRefetchTrigger) return;

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
  }, [user, taskViewRefetchTrigger, rangeStart, rangeEnd, taskCacheKey]); // Added taskCacheKey dependency

  useEffect(() => {
    // ... (Scroll handling logic remains the same)
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
        // NOTE: Keeping the scroll offset fix, which is still prone to jumpiness,
        // but required for now until a virtualization solution is adopted.
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
        // Check section top relative to container top
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

  const deleteTaskUI = async (taskId: string) => {
    setLoading(true);
    try {
      await deleteTask(taskId);
      toast.success("Delete task successfully");
      // Local state update is sufficient here
      setTasks((prev) => prev.filter((t) => t.id !== taskId));

      // OPTIONAL: Since the task is deleted, the schedule state in ViewLayout
      // might need a cleanup if it holds a reference to this task.
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full pl-4 sm:pl-6 lg:pl-8 relative overflow-y-auto bg-background"
    >
      {range.map((date) => (
        <DateSection
          key={format(date, "yyyy-MM-dd")}
          date={date}
          tasks={Array.from(
            taskGroup.get(format(date, "yyyy-MM-dd"))?.values() ?? [],
          )}
          loading={loading}
          deleteSchedule={deleteSchedule}
          deleteTask={deleteTaskUI}
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
    <section
      className="bg-background py-3 max-w-screen mr-3"
      id={format(date, "yyyy-MM-dd")}
    >
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
