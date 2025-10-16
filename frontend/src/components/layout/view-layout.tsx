import { useNavigate } from "react-router-dom";
import { useUserStore } from "../../hooks/use-user-store";
import {
  ReactNode,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  GetSchedulesResponse,
  Schedule,
  ScheduleResponse,
} from "../../types/schedule";
import { Task } from "../../types/tasks";
import { format, addDays, subDays } from "date-fns";
import { toast } from "sonner";
import { getData, postData, deleteData, patchData } from "../../api";
import { EditTaskDialog } from "../tasks/edit-task-dialog";
import { CalendarGrid } from "../calendar/grid";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";

interface BodyProps {
  schedules: Schedule[];
  selectedDate: Date;
  openEditTaskDialog: (taskId: string) => void;
  deleteSchedule: (
    taskId: string,
    date: string,
    split: number
  ) => Promise<void>;
  currentView: string;
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
  const [unscheduledTasks, setUnscheduledTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentView, setCurrentView] = useState("Day view");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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
  const droppedOutSchedules = schedules.filter((s) => s.start === null);
  const scheduled = schedules.filter((s) => s.start !== null);

  // --- Data & Logic Handlers ---
  const nextDay = addDays(selectedDate, 1);

  const loadUnscheduledTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getData<{ data: Task[] }>(
        `/tasks/schedule/none?start=${format(
          selectedDate,
          "yyyy-MM-dd"
        )}&end=${format(nextDay, "yyyy-MM-dd")}`
      );
      setUnscheduledTasks(response.data);
    } catch (error) {
      toast.error("Failed to load unscheduled tasks: " + error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate]);

  const loadSchedules = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getData<GetSchedulesResponse>(
        `/schedules?start=${format(selectedDate, "yyyy-MM-dd")}&end=${format(
          nextDay,
          "yyyy-MM-dd"
        )}`
      );
      setSchedules(response.data);
    } catch (error) {
      toast.error("Failed to load schedules: " + error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedDate) return;
    loadUnscheduledTasks();
    loadSchedules();
  }, [selectedDate, loadUnscheduledTasks, loadSchedules]);

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
      setIsLoading(true);
      const response = await postData<object, ScheduleResponse>("/schedule", {
        scheduleDate: format(selectedDate, "yyyy-MM-dd"),
      });
      if (response.feasible) {
        toast.success("Schedule successfully!");
      } else {
        toast.error(
          "Infeasible schedule. Please shorten or drop some mandatory tasks"
        );
      }
      setSchedules(response.data || scheduled); // Use scheduled as fallback
    } catch (error: any) {
      toast.error(error.message || "Failed to schedule tasks");
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate, scheduled]);

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
      } catch (error: any) {
        toast.error(
          error.message || "Failed to remove tasks from dropout list"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [selectedDate, schedules]
  );

  const addToSchedule = useCallback(
    async (taskId: string) => {
      setIsLoading(true);
      try {
        await patchData(`/tasks/${taskId}`, {
          scheduleDate: format(selectedDate, "yyyy-MM-dd"),
        });
        toast.success("Task added to the day's schedule");
        // Re-run schedule to place the task
        await schedule();
        setUnscheduledTasks((prev) => prev.filter((t) => t.id !== taskId));
      } catch (error: any) {
        toast.error(
          error.message || "Failed to add task to the day's schedule"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [selectedDate, schedule]
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
          setUnscheduledTasks((prev) => [...prev, toRemove.task as Task]);
        }
      } catch (error: any) {
        toast.error(error.message || "Failed to delete schedule :'(");
      }
    },
    [schedules]
  );

  if (!user && (userFetching === null || userFetching)) return null;

  // Props passed to the main content render prop
  const bodyProps = {
    schedules: scheduled,
    selectedDate,
    openEditTaskDialog,
    deleteSchedule,
    currentView,
  };

  return (
    <>
      <div className="h-screen w-screen flex flex-col bg-gray-100 text-foreground antialiased dark:bg-gray-950">
        <Navbar
          selectedDate={selectedDate}
          currentView={currentView}
          setCurrentView={setCurrentView}
          navigateDate={navigateDate}
          goToToday={goToToday}
          schedule={schedule}
          isLoading={isLoading}
        />

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Main Content Area: Render Prop */}
          {/* If renderBody is provided, call it with bodyProps, otherwise use the DefaultCalendarGrid */}
          {renderBody ? renderBody(bodyProps) : <CalendarGrid {...bodyProps} />}

          {/* Sidebar */}
          <Sidebar
            selectedDate={selectedDate}
            handleDateChange={handleDateChange}
            droppedOutSchedules={droppedOutSchedules}
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
          // The updateSchedule prop is still required to handle internal state update after dialog edit
          updateSchedule={(task) => {
            setSchedules((prev) =>
              prev.map((p) => (p.task.id === task.id ? { ...p, task } : p))
            );
          }}
        />
      )}
    </>
  );
}
