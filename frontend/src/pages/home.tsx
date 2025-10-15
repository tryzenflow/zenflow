import { ButtonGroup } from "@/components/ui/button-group";
import { addDays, format, subDays } from "date-fns";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  WandSparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { deleteData, getData, patchData } from "../api";
import { CalendarGrid } from "../components/calendar/grid";
import {
  DroppedScheduleItem,
  MiniCalendar,
  UnscheduledTaskItem,
} from "../components/calendar/sidebar";
import { CreateTaskDialog } from "../components/tasks/create-task-dialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ScrollArea } from "../components/ui/scroll-area";
import { Separator } from "../components/ui/separator";
import { useUserStore } from "../hooks/use-user-store";
import { Schedule, SchedulesResponse } from "../types/schedule";
import { Task, TasksResponse } from "../types/tasks";

const VIEWS = ["Day view", "Week view", "Month view", "Year view"];

export default function HomePage() {
  const user = useUserStore((state) => state.user);
  const userFetching = useUserStore((state) => state.loading);
  const navigate = useNavigate();
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
  }, [user, userFetching]);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentView, setCurrentView] = useState("Day view"); // Day view, Week view, Task view, etc.
  const [unscheduledTasks, setUnscheduledTasks] = useState<Task[]>([]);

  const droppedOutSchedules = schedules.filter((s) => s.start === null);

  const loadUnscheduledTasks = async () => {
    setIsLoading(true);
    try {
      const nextDay = addDays(selectedDate, 1);
      const response = await getData<TasksResponse>(
        `/tasks/schedule/none?start=${format(
          selectedDate,
          "yyyy-MM-dd"
        )}&end=${format(nextDay, "yyyy-MM-dd")}`
      );

      if (response.success) {
        setUnscheduledTasks(response.data);
        console.log({ response });
      } else {
        toast.error("Failed to load schedules: " + response.message);
      }
    } catch (error) {
      toast.error("Network or parsing error: " + error);
    } finally {
      setIsLoading(false);
    }
  };
  const loadSchedules = async () => {
    setIsLoading(true);
    try {
      const nextDay = addDays(selectedDate, 1);
      const response = await getData<SchedulesResponse>(
        `/schedules?start=${format(selectedDate, "yyyy-MM-dd")}&end=${format(
          nextDay,
          "yyyy-MM-dd"
        )}`
      );

      if (response.success) {
        setSchedules(response.data);
      } else {
        toast.error("Failed to load schedules: " + response.message);
      }
    } catch (error) {
      toast.error("Network or parsing error: " + error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedDate) return;
    loadUnscheduledTasks();
    loadSchedules();
  }, [selectedDate]);

  // --- UI Handlers ---

  const handleDateChange = useCallback((date: Date) => {
    setSelectedDate(date);
  }, []);

  const goToToday = useCallback(() => {
    const today = new Date();
    setSelectedDate(today);
  }, []);

  const navigateDate = useCallback(
    (direction: "next" | "prev") => {
      const newDate =
        direction === "next"
          ? addDays(selectedDate, 1)
          : subDays(selectedDate, 1);
      handleDateChange(newDate);
    },
    [selectedDate, addDays, subDays, handleDateChange]
  );

  const deleteDropoutTasks = async (id: string, split: number) => {
    try {
      await deleteData(
        `/schedules/${format(selectedDate, "y/M/d")}/tasks/${id}/split/${split}`
      );
      toast.success("Delete dropped out task successfully");
    } catch (error: any) {
      toast.error(
        error.message || "Failed to remove tasks from the day's schedule"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const addToSchedule = async (taskId: string) => {
    setIsLoading(true);
    try {
      await patchData(`/tasks/${taskId}`, {
        scheduleDate: format(selectedDate, "yyyy-MM-dd"),
      });
      toast.success("Task added to the day's schedule");
    } catch (error: any) {
      toast.error(error.message || "Failed to add task to the day's schedule");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-muted/20 text-foreground antialiased">
      {/* HEADER BAR (Simulating component usage: Button, DropdownMenu) */}
      <header className="flex items-center w-full justify-between px-4 sm:px-6 lg:px-8 py-4 border-b bg-background shadow-sm">
        <div className="sticky top-0 bg-background/95 backdrop-blur-sm z-20">
          <div className="flex-1 font-semibold text-lg">
            {format(selectedDate, "MMM d, yyyy")}
            <div className="text-muted-foreground font-normal text-sm">
              {format(selectedDate, "EEEE")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-x-3">
          <ButtonGroup className="hidden sm:flex" aria-label="Button group">
            <Button
              variant="secondary"
              onClick={() => navigateDate("prev")}
              size="icon"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="secondary" onClick={goToToday}>
              Today
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigateDate("next")}
              size="icon"
            >
              <ChevronRight className="size-4" />
            </Button>
          </ButtonGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="hidden sm:flex">
                {currentView}
                <ChevronDown className="size-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  value={currentView}
                  onValueChange={(value) => setCurrentView(value)}
                >
                  {VIEWS.map((v) => (
                    <DropdownMenuRadioItem key={v} value={v}>
                      {v}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioItem value="Task view">
                    Task view
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button>
            <WandSparklesIcon className="size-4" /> Schedule
          </Button>
          <Separator orientation="vertical" className="min-h-9" />
          <CreateTaskDialog />
        </div>
      </header>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <CalendarGrid selectedDate={selectedDate} schedules={schedules} />

        <ScrollArea className="w-full hidden md:block md:w-96 border-l pb-4 px-4 flex-shrink-0 bg-background/50 dark:bg-slate-900 overflow-y-auto">
          {/* MINI CALENDAR */}
          <MiniCalendar
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
          />

          <div className="mt-6 space-y-6">
            {/* DROPPED TASKS */}
            {droppedOutSchedules.length > 0 && (
              <div className="px-6">
                <div className="flex items-center gap-x-3">
                  <h3 className="font-semibold text-sm">Dropout Tasks</h3>
                  <Badge className="rounded-full" variant="destructive">
                    {droppedOutSchedules.length}
                  </Badge>
                </div>
                <div>
                  {droppedOutSchedules.map((s) => (
                    <DroppedScheduleItem
                      key={`${s.task.id}-${s.date}-${s.split}`}
                      duration={s.task.duration}
                      taskId={s.task.id}
                      title={s.task.title}
                      deleteDropoutTask={(id) =>
                        deleteDropoutTasks(id, s.split)
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* UNSCHEDULED TASKS */}
            {unscheduledTasks.length > 0 && (
              <div className="px-6">
                <div className="flex items-center gap-x-3">
                  <h3 className="font-semibold text-sm">Unscheduled Tasks</h3>
                  <Badge className="rounded-full">
                    {unscheduledTasks.length}
                  </Badge>
                </div>
                <div>
                  {unscheduledTasks.map((task) => (
                    <UnscheduledTaskItem
                      addToSchedule={addToSchedule}
                      taskId={task.id}
                      key={task.id}
                      title={task.title}
                      duration={task.duration}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
