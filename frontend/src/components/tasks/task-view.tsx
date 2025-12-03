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
  taskViewRefetchTrigger,
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
  taskViewRefetchTrigger: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const user = useUserStore((state) => state.user);

  // Configuration
  const EXPANSION_DAYS = 7; // how many days to expand when at edges or ensuring visibility
  const SELECTED_DEBOUNCE_MS = 150;
  const EDGE_THRESHOLD = 100; // px to trigger expansion on scroll edges

  const selectedDebounceRef = useRef<number | null>(null);

  // Local task state
  const [tasks, setTasks] = useState<Task[]>([]);

  const [taskCacheKey, setTaskCacheKey] = useState(taskViewRefetchTrigger);

  useEffect(() => {
    if (taskViewRefetchTrigger !== taskCacheKey) {
      setTasks([]);
      // Use expandRangeLeft helper so we preserve scroll when prepending
      expandRangeLeft(subDays(selectedDate, EXPANSION_DAYS));
      setRangeEnd(addDays(selectedDate, EXPANSION_DAYS));
      prevRangeRef.current = null;
      setTaskCacheKey(taskViewRefetchTrigger);
    }
  }, [taskViewRefetchTrigger, taskCacheKey, selectedDate]);

  const [rangeStart, setRangeStart] = useState(() =>
    subDays(selectedDate, EXPANSION_DAYS),
  );
  const [rangeEnd, setRangeEnd] = useState(() =>
    addDays(selectedDate, EXPANSION_DAYS),
  );

  const range = useMemo(
    () => eachDayOfInterval({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd],
  );

  // Refs & helpers for preserving scroll when prepending columns
  const prevScrollWidthRef = useRef<number | null>(null);
  const expandLeftPendingRef = useRef(false);

  const expandRangeLeft = (newStart: Date) => {
    const container = containerRef.current;
    if (container) prevScrollWidthRef.current = container.scrollWidth;
    expandLeftPendingRef.current = true;
    setRangeStart(newStart);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!expandLeftPendingRef.current) return;

    // Use RAF after render to compute final scrollWidth
    requestAnimationFrame(() => {
      const prev = prevScrollWidthRef.current ?? 0;
      const delta = container.scrollWidth - prev;
      if (delta > 0) {
        container.scrollLeft = (container.scrollLeft || 0) + delta;
      }
      expandLeftPendingRef.current = false;
      prevScrollWidthRef.current = null;
    });
  }, [rangeStart, rangeEnd]);

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
        let responseTasks: Task[] = [];

        if (
          Array.isArray(response.data) &&
          response.data.length > 0 &&
          "task" in (response.data as any)[0]
        ) {
          const rows = response.data as any[];
          const map = new Map<string, Task>();
          for (const row of rows) {
            const taskObj = row.task as Schedule["task"];
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
                rrule: taskObj.rrule,
              },
            };

            const existing = map.get(taskObj.id);
            if (!existing) {
              map.set(taskObj.id, {
                id: taskObj.id,
                title: taskObj.title,
                focus: taskObj.focus,
                duration: taskObj.duration,
                schedules: [schedule],
              } as Task);
            } else {
              existing.schedules = [...(existing.schedules ?? []), schedule];
            }
          }
          responseTasks = Array.from(map.values());
        } else {
          responseTasks = response.data as Task[];
        }

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
              existingTasksMap.set(newTask.id, {
                ...newTask,
                schedules: dedupeSchedules(newTask.schedules),
              });
            } else {
              const combined = [
                ...(existing.schedules || []),
                ...(newTask.schedules || []),
              ];
              existingTasksMap.set(newTask.id, {
                ...existing,
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

  const taskGroup = useMemo(() => {
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

    if (!prev) {
      prevRangeRef.current = { start: rangeStart, end: rangeEnd };
      fetchTasks(rangeStart, rangeEnd);
      return;
    }

    if (rangeStart < prev.start) {
      fetchTasks(rangeStart, subDays(prev.start, 1));
    }

    if (rangeEnd > prev.end) {
      fetchTasks(addDays(prev.end, 1), rangeEnd);
    }

    prevRangeRef.current = { start: rangeStart, end: rangeEnd };
  }, [user, taskViewRefetchTrigger, rangeStart, rangeEnd, taskCacheKey]);

  // Horizontal scroll handling for kanban (uses expandRangeLeft to preserve scroll)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading) return;

    const handleScroll = () => {
      if (loading) return;
      const { scrollLeft, scrollWidth, clientWidth } = container;
      const atLeft = scrollLeft < EDGE_THRESHOLD;
      const atRight = scrollLeft + clientWidth > scrollWidth - EDGE_THRESHOLD;

      if (atLeft) {
        expandRangeLeft(subDays(rangeStart, EXPANSION_DAYS));
        // nudge a bit so we don't retrigger immediately
        container.scrollLeft = scrollLeft + EDGE_THRESHOLD;
      }

      if (atRight) {
        setRangeEnd((prev) => addDays(prev, EXPANSION_DAYS));
      }

      // Determine currently visible column (closest to container left + small offset)
      const sections = container.querySelectorAll<HTMLElement>("section[id]");
      let closest: HTMLElement | null = null;
      let minDistance = Infinity;
      const containerRect = container.getBoundingClientRect();

      sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        // distance from section left to container left (we want the section nearest to the left edge)
        const distance = Math.abs(rect.left - containerRect.left + 8);
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

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loading, selectedDate, setSelectedDate, EXPANSION_DAYS, rangeStart]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading) return;

    if (selectedDebounceRef.current) {
      window.clearTimeout(selectedDebounceRef.current);
      selectedDebounceRef.current = null;
    }

    // Expand if selected is outside current range
    if (selectedDate < rangeStart) {
      expandRangeLeft(subDays(selectedDate, EXPANSION_DAYS));
      return;
    } else if (selectedDate > rangeEnd) {
      setRangeEnd(addDays(selectedDate, EXPANSION_DAYS));
      return;
    }

    selectedDebounceRef.current = window.setTimeout(() => {
      const id = format(selectedDate, "yyyy-MM-dd");
      const section = container.querySelector<HTMLElement>(
        `section[id="${id}"]`,
      );
      if (!section) return;
      requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const left =
          sectionRect.left - containerRect.left + container.scrollLeft - 30;
        container.scrollTo({ left, behavior: "smooth" });
      });
    }, SELECTED_DEBOUNCE_MS);

    return () => {
      if (selectedDebounceRef.current) {
        window.clearTimeout(selectedDebounceRef.current);
        selectedDebounceRef.current = null;
      }
    };
  }, [selectedDate, rangeStart, rangeEnd, loading, taskCacheKey]);

  const deleteTaskUI = async (taskId: string) => {
    setLoading(true);
    try {
      await deleteTask(taskId);
      toast.success("Delete task successfully");
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } finally {
      setLoading(false);
    }
  };

  return (
    // main horizontal scroll container (snapping removed)
    <div
      ref={containerRef}
      className="h-full w-full pl-4 sm:pl-6 lg:pl-8 relative overflow-y-hidden bg-background"
      style={{
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div className="flex items-start gap-3" style={{ paddingBottom: 24 }}>
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
  const [navbarHeight, setNavbarHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const navbar = document.getElementById("navbar");
    if (navbar) {
      setNavbarHeight(navbar.offsetHeight);
    }

    if (headerRef.current) {
      setHeaderHeight(headerRef.current.getBoundingClientRect().height);
    }
  }, []);

  return (
    <section
      id={format(date, "yyyy-MM-dd")}
      // treat each column as a vertical flex column that fills container height
      className="flex-shrink-0 min-w-72 w-fit flex flex-col"
    >
      {/* Sticky header so it stays under the navbar when vertical-scroll happens inside the column */}
      <div
        ref={headerRef}
        className="z-20 pt-3 pb-0 bg-background mb-0 sticky top-0"
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
        <Separator className="mt-3" />
      </div>

      {/* Tasks container: vertical scrolling if needed */}
      <div
        className="py-3 overflow-y-auto"
        style={{
          height: `calc(100vh - ${navbarHeight}px - ${headerHeight}px)`,
        }}
      >
        <div className="flex flex-col gap-3">
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
      </div>
    </section>
  );
}
