import { useState } from "react";
import { Schedule } from "../../types/schedule";
import { Task } from "../../types/tasks";
import {
  DroppedScheduleItem,
  MiniCalendar,
  TaskItem,
} from "../calendar/sidebar";
import { Badge } from "../ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Button } from "../ui/button";
import { ChevronDown, MenuIcon, RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";
import { Sidebar, SidebarContent, SidebarGroup } from "../ui/sidebar";

interface SidebarProps {
  selectedDate: Date;
  recurringTasks: Task[];
  handleDateChange: (date: Date) => void;
  droppedOutSchedules: Schedule[];
  unscheduledTasks: Task[];
  openEditTaskDialog: (taskId: string) => void;
  deleteDropoutTasks: (id: string, split: number) => Promise<void>;
  deleteUnscheduledTasks: (id: string) => void;
  addToSchedule: (taskId: string) => Promise<void>;
}

export const AppSidebar = ({
  selectedDate,
  recurringTasks,
  handleDateChange,
  droppedOutSchedules,
  unscheduledTasks,
  openEditTaskDialog,
  deleteDropoutTasks,
  deleteUnscheduledTasks: deleteTask,
  addToSchedule,
}: SidebarProps) => {
  const [isDropoutTasksCollapsed, setIsDropoutTasksCollapsed] = useState(true);
  const [isRecommendedTasksCollapsed, setIsRecommendedTasksCollapsed] =
    useState(true);
  const [isRecurringTasksCollapsed, setIsRecurringTasksCollapsed] =
    useState(true);
  const [showMore, setShowMore] = useState(false);
  return (
    <Sidebar side="right">
      <SidebarContent className="w-full flex-shrink-0 bg-white overflow-y-auto">
        <SidebarGroup className="bg-white z-10 pt-4 pb-2">
          {/* MINI CALENDAR */}
          <MiniCalendar
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
          />
        </SidebarGroup>

        <SidebarGroup>
          {recurringTasks.length > 0 && (
            <Collapsible
              open={isRecurringTasksCollapsed}
              onOpenChange={setIsRecurringTasksCollapsed}
              className="px-6 relative"
            >
              <div className="flex justify-between items-center gap-x-3 border-b border-border">
                <div className="flex sticky top-0 items-center gap-x-3 bg-white py-2">
                  <h3 className="font-semibold text-sm text-foreground">
                    Recurring Tasks
                  </h3>
                  <RefreshCw className="size-4 text-muted-foreground" />
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <ChevronDown
                      className={cn(
                        "size-4 transition-all",
                        isRecurringTasksCollapsed && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                {recurringTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    duration={task.duration}
                    taskId={task.id}
                    title={task.title}
                    addToSchedule={addToSchedule}
                    isRecurring
                    deleteTask={deleteTask}
                    openEditTaskDialog={openEditTaskDialog}
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </SidebarGroup>

        <SidebarGroup>
          {droppedOutSchedules.length > 0 && (
            <Collapsible
              open={isDropoutTasksCollapsed}
              onOpenChange={setIsDropoutTasksCollapsed}
              className="px-6 relative"
            >
              <div className="flex justify-between items-center gap-x-3">
                <div className="flex sticky top-0 items-center gap-x-3 bg-white py-2 border-b border-border">
                  <h3 className="font-semibold text-sm text-foreground">
                    Dropout Tasks
                  </h3>
                  <Badge className="rounded-full" variant="destructive">
                    {droppedOutSchedules.length}
                  </Badge>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <ChevronDown
                      className={cn(
                        "size-4 transition-all",
                        isDropoutTasksCollapsed && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                {droppedOutSchedules.map((s) => (
                  <DroppedScheduleItem
                    key={`${s.task.id}-${s.date}-${s.split}`}
                    duration={s.task.duration}
                    taskId={s.task.id}
                    title={s.task.title}
                    split={s.split}
                    openEditTaskDialog={openEditTaskDialog}
                    deleteDropoutTask={deleteDropoutTasks}
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </SidebarGroup>

        <SidebarGroup>
          {unscheduledTasks.length > 0 && (
            <Collapsible
              open={isRecommendedTasksCollapsed}
              onOpenChange={setIsRecommendedTasksCollapsed}
              className="px-6 relative"
            >
              <div className="justify-between flex items-center gap-x-3 border-b border-border">
                <div className="flex sticky top-0 items-center gap-x-3 bg-white py-2">
                  <h3 className="font-semibold text-sm text-foreground">
                    Recommended
                  </h3>
                </div>
                <CollapsibleTrigger asChild>
                  <Button size="icon-sm" variant="ghost">
                    <ChevronDown
                      className={cn(
                        "size-4 transition-all",
                        isRecommendedTasksCollapsed && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>

              <CollapsibleContent>
                {unscheduledTasks
                  .slice(0, !showMore ? 5 : undefined)
                  .map((task) => (
                    <TaskItem
                      addToSchedule={addToSchedule}
                      taskId={task.id}
                      deleteTask={deleteTask}
                      key={task.id}
                      isRecurring={false}
                      title={task.title}
                      openEditTaskDialog={openEditTaskDialog}
                      duration={task.duration}
                    />
                  ))}
                {unscheduledTasks.length > 5 && (
                  <Button
                    size="sm"
                    className="p-0"
                    variant="link"
                    onClick={() => setShowMore(!showMore)}
                  >
                    Show {showMore ? "less" : "more"}
                  </Button>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};
