import { useState } from "react";
import { Schedule } from "../../types/schedule";
import { Task } from "../../types/tasks";
import {
  DroppedScheduleItem,
  MiniCalendar,
  UnscheduledTaskItem,
} from "../calendar/sidebar";
import { Badge } from "../ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface SidebarProps {
  selectedDate: Date;
  handleDateChange: (date: Date) => void;
  droppedOutSchedules: Schedule[];
  unscheduledTasks: Task[];
  openEditTaskDialog: (taskId: string) => void;
  deleteDropoutTasks: (id: string, split: number) => Promise<void>;
  addToSchedule: (taskId: string) => Promise<void>;
}

export const Sidebar = ({
  selectedDate,
  handleDateChange,
  droppedOutSchedules,
  unscheduledTasks,
  openEditTaskDialog,
  deleteDropoutTasks,
  addToSchedule,
}: SidebarProps) => {
  const [isDropoutTasksCollapsed, setIsDropoutTasksCollapsed] = useState(true);
  const [isUnscheduledTasksCollapsed, setIsUnscheduledTasksCollapsed] =
    useState(true);
  useState(false);
  return (
    <ScrollArea className="w-full hidden md:block md:w-96 border-l px-4 flex-shrink-0 bg-muted overflow-y-auto">
      <div className="bg-muted z-10 pt-4 pb-2">
        {/* MINI CALENDAR */}
        <MiniCalendar
          selectedDate={selectedDate}
          onDateChange={handleDateChange}
        />
      </div>

      {droppedOutSchedules.length > 0 && (
        <Collapsible
          open={isDropoutTasksCollapsed}
          onOpenChange={setIsDropoutTasksCollapsed}
          className="px-6 relative"
        >
          <div className="flex justify-between items-center gap-x-3">
            <div className="flex sticky top-0 items-center gap-x-3 bg-muted py-2 border-b border-border">
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
                    isDropoutTasksCollapsed && "rotate-180"
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

      {unscheduledTasks.length > 0 && (
        <Collapsible
          open={isUnscheduledTasksCollapsed}
          onOpenChange={setIsUnscheduledTasksCollapsed}
          className="px-6 relative"
        >
          <div className="justify-between flex items-center gap-x-3">
            <div className="flex sticky top-0 items-center gap-x-3 bg-muted py-2 border-b border-border">
              <h3 className="font-semibold text-sm text-foreground">
                Unscheduled Tasks
              </h3>
              <Badge>{unscheduledTasks.length}</Badge>
            </div>
            <CollapsibleTrigger asChild>
              <Button size="icon-sm" variant="ghost">
                <ChevronDown
                  className={cn(
                    "size-4 transition-all",
                    isUnscheduledTasksCollapsed && "rotate-180"
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            {unscheduledTasks.map((task) => (
              <UnscheduledTaskItem
                addToSchedule={addToSchedule}
                taskId={task.id}
                key={task.id}
                title={task.title}
                openEditTaskDialog={openEditTaskDialog}
                duration={task.duration}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </ScrollArea>
  );
};
