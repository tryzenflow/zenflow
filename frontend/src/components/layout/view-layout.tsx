import { useNavigate } from "react-router-dom";
import { useUserStore } from "../../hooks/use-user-store";
import {
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  GetSchedulesResponse,
  Schedule,
  ScheduleResponse,
} from "../../types/schedule";
import { Task } from "../../types/tasks";
import {
  format,
  addDays,
  subDays,
  startOfWeek,
  startOfMonth,
  endOfWeek,
  endOfMonth,
} from "date-fns";
import { toast } from "sonner";
import { getData, postData, deleteData, patchData, putData } from "../../api";
import { EditTaskDialog } from "../tasks/edit-task-dialog";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";

interface BodyProps {
  schedules: Schedule[];
  selectedDate: Date;
  currentView: string;
  // REMOVED: tasks, setTasks
  openEditTaskDialog: (taskId: string) => void;
  setSelectedDate: (date: Date) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  deleteSchedule: (
    taskId: string,
    date: string,
    split: number
  ) => Promise<void>;
  setCurrentView: (view: string) => void;
  updateScheduleTime: (
    taskId: string,
    date: string,
    split: number,
    newStart: number,
    newEnd: number
  ) => void;
  taskViewRefetchTrigger: number;
  setTaskViewRefetchTrigger: Dispatch<SetStateAction<number>>;
}

export default function ViewLayout({
  renderBody,
}: {
  renderBody: (bodyProps: BodyProps) => ReactNode;
}) {
  const user = useUserStore().user;
  const userFetching = useUserStore().loading;
  const navigate = useNavigate();

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  // REMOVED: tasks state
  const [unscheduledTasks, setUnscheduledTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentView, setCurrentView] = useState("Task view");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  // NEW: State to force TaskView to refetch/re-render its data
  const [taskViewRefetchTrigger, setTaskViewRefetchTrigger] = useState(0);

  // Auth/Redirect logic (placeholders)
  useEffect(() => {
    if (userFetching === null || userFetching) return;
    if (!user) {
      navigate("/login?callback=/");
      return;
    }
    if (user._count.categories === 0 || user._count.constraints === 0) {
      navigate("/prefs?callback=/");
      return;
    }
  }, [user, userFetching, navigate]);

  // Derived state
  const droppedOutSchedules: Schedule[] = useMemo(() => {
    // (has a null schedule) & (on selected date)
    return schedules.filter(
      (s) =>
        s.start === null &&
        format(new Date(s.date), "yyyy-MM-dd") ===
          format(selectedDate, "yyyy-MM-dd")
    );
  }, [schedules, selectedDate]); // Dependency simplified

  const scheduled = schedules.filter((s) => s.start !== null);

  const loadUnscheduledTasks = useCallback(async () => {
    setLoading(true);
    const selectedDateStr = format(selectedDate, "yyyy-MM-dd");

    try {
      const response = await getData<{ data: Task[] }>(
        `/tasks/schedule/none?start=${selectedDateStr}&end=${selectedDateStr}`
      );

      setUnscheduledTasks(response.data);
    } catch (error) {
      toast.error("Failed to load unscheduled tasks: " + error);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    let startDateStr = format(selectedDate, "yyyy-MM-dd");
    let endDateStr = startDateStr; // For single day fetch
    if (currentView === "Week view") {
      const endDate = addDays(selectedDate, 6);
      startDateStr = format(startOfWeek(selectedDate), "yyyy-MM-dd");
      endDateStr = format(endDate, "yyyy-MM-dd");
    } else if (currentView === "Month view") {
      startDateStr = format(
        startOfWeek(startOfMonth(selectedDate)),
        "yyyy-MM-dd"
      );
      endDateStr = format(endOfWeek(endOfMonth(selectedDate)), "yyyy-MM-dd");
    } else if (currentView === "Year view") {
      const startOfYear = new Date(selectedDate.getFullYear(), 0, 1);
      const endOfYear = new Date(selectedDate.getFullYear(), 11, 31);
      startDateStr = format(startOfYear, "yyyy-MM-dd");
      endDateStr = format(endOfYear, "yyyy-MM-dd");
    }

    try {
      const schedResp = await getData<GetSchedulesResponse>(
        `/schedules?start=${startDateStr}&end=${endDateStr}`
      );

      setSchedules(schedResp.data);
    } catch (error: any) {
      toast.error("Failed to load data: " + (error?.message || error));
    } finally {
      setLoading(false);
    }
  }, [currentView, selectedDate]);

  // run when selectedDate changes
  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    loadUnscheduledTasks();
  }, [loadUnscheduledTasks]);

  const handleDateChange = useCallback((date: SetStateAction<Date>) => {
    setSelectedDate(date);
  }, []);

  const goToToday = useCallback(() => {
    setSelectedDate(new Date());
  }, []);

  const navigateDate = useCallback(
    (direction: string) => {
      const newDate =
        direction === "next"
          ? addDays(selectedDate, 1)
          : subDays(selectedDate, 1);
      handleDateChange(newDate);
    },
    [selectedDate, handleDateChange]
  );

  const schedule = useCallback(async () => {
    try {
      setLoading(true);
      const formattedScheduleDate = format(selectedDate, "yyyy-MM-dd");
      const response = await postData<object, ScheduleResponse>("/schedule", {
        scheduleDate: formattedScheduleDate,
      });
      if (response.feasible) {
        toast.success("Schedule successfully!");
      } else {
        toast.error(
          "Infeasible schedule. Please shorten or drop some mandatory tasks"
        );
      }

      const generated = response.data;

      setSchedules((prev) => [
        ...prev.filter(
          (s) =>
            format(new Date(s.date), "yyyy-MM-dd") !== formattedScheduleDate
        ),
        ...generated,
      ]);

      setTaskViewRefetchTrigger((prev) => prev + 1);

      loadUnscheduledTasks();
    } catch (error: any) {
      toast.error(error.message || "Failed to schedule tasks");
      throw error;
    } finally {
      setLoading(false);
    }
  }, [selectedDate, scheduled, loadUnscheduledTasks]); // Dependencies updated

  const openEditTaskDialog = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setEditDialogOpen(true);
  }, []);

  const deleteDropoutTasks = useCallback(
    async (id: string, split: number) => {
      try {
        await deleteData(
          `/schedules/${format(
            selectedDate,
            "y/M/d"
          )}/tasks/${id}/split/${split}`
        );

        const toRemove = schedules.find(
          (s) => s.task.id === id && s.split === split && s.start === null
        );

        setSchedules((prev) =>
          prev.filter(
            (s) => s.task.id !== id || s.split !== split || s.start !== null
          )
        );

        if (toRemove) {
          setUnscheduledTasks((prev) => [...prev, toRemove.task as Task]);
        }
        toast.success("Delete dropped out task successfully");
        setTaskViewRefetchTrigger((prev) => prev + 1); // Trigger TaskView
      } catch (error: any) {
        toast.error(
          error.message || "Failed to remove tasks from dropout list"
        );
      } finally {
        setLoading(false);
      }
    },
    [selectedDate, schedules]
  );

  const addToSchedule = useCallback(
    async (taskId: string) => {
      setLoading(true);
      try {
        await patchData(`/tasks/${taskId}`, {
          scheduleDate: format(selectedDate, "yyyy-MM-dd"),
        });
        setUnscheduledTasks((prev) => prev.filter((t) => t.id !== taskId));
        toast.success("Task added to the day's schedule");
        try {
          await schedule();
        } catch (error: any) {
          const task = unscheduledTasks.find((t) => t.id === taskId);
          if (!task) return;

          setSchedules((prev) => [
            ...prev,
            {
              date: format(selectedDate, "yyyy-MM-dd"),
              start: null,
              end: null,
              split: 0,
              task,
            },
          ]);
        }
      } catch (error: any) {
        toast.error(error.message || "Failed to add task to schedule");
      } finally {
        setLoading(false);
      }
    },
    [selectedDate, schedule, unscheduledTasks]
  );

  const deleteSchedule = useCallback(
    async (taskId: string, date: string, split: number) => {
      try {
        const formatted = format(new Date(date), "y/M/d");
        await deleteData(
          `/schedules/${formatted}/tasks/${taskId}/split/${split}`
        );

        const toRemove = schedules.find(
          (s) => s.split === split && s.task.id === taskId && s.date === date
        );
        setSchedules((prev) =>
          prev.filter(
            (s) => s.split !== split || s.task.id !== taskId || s.date !== date
          )
        );

        const splitExists = schedules.some(
          (s) => s.task.id === taskId && s.split !== split
        );
        toast.success("Delete schedule successfully 🎉");

        if (toRemove && !splitExists) {
          // If all schedules for this task are gone, re-add to unscheduled list
          // This should only happen if the date is the selectedDate, but we run with it.
          setUnscheduledTasks((prev) => [...prev, toRemove.task as Task]);
        }

        // Trigger TaskView refetch
        setTaskViewRefetchTrigger((prev) => prev + 1);
      } catch (error: any) {
        toast.error(error.message || "Failed to delete schedule :'(");
      }
    },
    [schedules]
  );

  const deleteUnscheduledTasks = async (id: string) => {
    setLoading(true);
    try {
      await deleteData(`/tasks/${id}`);
      toast.success("Delete task successfully");
      setUnscheduledTasks((prev) => prev.filter((t) => t.id !== id));
      // Trigger TaskView refetch
      setTaskViewRefetchTrigger((prev) => prev + 1);
    } finally {
      setLoading(false);
    }
  };

  const updateScheduleTime = async (
    taskId: string,
    date: string,
    split: number,
    newStart: number,
    newEnd: number
  ) => {
    setLoading(true);
    try {
      const formatted = format(new Date(date), "y/M/d");
      await putData(`/schedules/${formatted}/tasks/${taskId}/split/${split}`, {
        start: newStart,
        end: newEnd,
      });
      setSchedules((prevSchedules) =>
        prevSchedules.map((s) => {
          const startDate = new Date(date);
          const endDate = new Date(date);
          startDate.setHours(0, newStart, 0, 0);
          endDate.setHours(0, newEnd, 0, 0);
          // Find the specific schedule using its unique keys
          if (s.task.id === taskId && s.date === date && s.split === split) {
            return {
              ...s,
              start: startDate.toISOString(),
              end: endDate.toISOString(),
            };
          }
          return s;
        })
      );
      // Trigger TaskView refetch
      setTaskViewRefetchTrigger((prev) => prev + 1);
    } finally {
      setLoading(false);
    }
  };

  if (!user && (userFetching === null || userFetching)) return null;

  // Props passed to the main content render prop
  const bodyProps: BodyProps = {
    schedules: scheduled,
    selectedDate,
    setSelectedDate,
    openEditTaskDialog,
    deleteSchedule,
    currentView,
    loading,
    setLoading,
    updateScheduleTime,
    setCurrentView,
    taskViewRefetchTrigger, // NEW
    setTaskViewRefetchTrigger, // NEW
  };

  return (
    <>
      <div className="h-screen w-screen flex flex-col bg-gray-100 text-foreground antialiased dark:bg-gray-950">
        <Navbar
          // addTask logic removed as tasks state is gone. If this feature is needed,
          // a refetch/re-render trigger must be added here for TaskView.
          addTask={() => setTaskViewRefetchTrigger((prev) => prev + 1)}
          selectedDate={selectedDate}
          currentView={currentView}
          setCurrentView={setCurrentView}
          navigateDate={navigateDate}
          goToToday={goToToday}
          schedule={schedule}
          isLoading={loading}
        />

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {renderBody(bodyProps)}

          {/* Sidebar */}
          <Sidebar
            selectedDate={selectedDate}
            handleDateChange={handleDateChange}
            droppedOutSchedules={droppedOutSchedules}
            deleteUnscheduledTasks={deleteUnscheduledTasks}
            unscheduledTasks={unscheduledTasks}
            openEditTaskDialog={openEditTaskDialog}
            deleteDropoutTasks={deleteDropoutTasks}
            addToSchedule={addToSchedule}
          />
        </div>
      </div>

      {/* Edit Dialog */}
      {selectedTaskId && (
        <EditTaskDialog
          selectedDate={selectedDate}
          open={editDialogOpen}
          setOpen={setEditDialogOpen}
          taskId={selectedTaskId}
          // The updateSchedule prop now updates schedules and triggers TaskView refetch
          updateSchedule={(task) => {
            setSchedules((prev) =>
              prev.map((p) => (p.task.id === task.id ? { ...p, task } : p))
            );
            setTaskViewRefetchTrigger((prev) => prev + 1);
          }}
        />
      )}
    </>
  );
}
