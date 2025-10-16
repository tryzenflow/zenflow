import { ArrowRight, Clock, Edit2, X } from "lucide-react";
import { formatMinutes } from "../../utils/prefs";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";

export const MiniCalendar = ({
  selectedDate,
  onDateChange,
}: {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}) => {
  return (
    <Calendar
      className="w-full"
      required
      mode="single"
      selected={selectedDate}
      onSelect={onDateChange}
    />
  );
};

export const DroppedScheduleItem = ({
  title,
  duration,
  taskId,
  deleteDropoutTask,
  openEditTaskDialog,
}: {
  title: string;
  duration: number;
  taskId: string;
  deleteDropoutTask: (id: string) => void;
  openEditTaskDialog: (taskId: string) => void;
}) => {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-b-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="flex items-center text-xs text-muted-foreground mt-0.5">
          <Clock className="h-3 w-3 mr-1" /> {formatMinutes(duration)}
        </div>
      </div>

      <div className="flex items-center gap-x-2">
        <Button
          variant="ghost"
          onClick={() => openEditTaskDialog(taskId)}
          size="icon"
          className="h-6 w-6"
        >
          <Edit2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          onClick={() => deleteDropoutTask(taskId)}
          size="icon"
          className="h-6 w-6"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export const UnscheduledTaskItem = ({
  title,
  duration,
  addToSchedule,
  openEditTaskDialog,
  taskId,
}: {
  title: string;
  duration: number;
  taskId: string;
  addToSchedule: (taskId: string) => void;
  openEditTaskDialog: (taskId: string) => void;
}) => (
  <div className="flex items-center justify-between py-3 border-b last:border-b-0">
    <div>
      <div className="text-sm font-medium">{title}</div>
      <div className="flex items-center text-xs text-muted-foreground mt-0.5">
        <Clock className="h-3 w-3 mr-1" /> {formatMinutes(duration)}
      </div>
    </div>
    <div className="flex items-center gap-x-2">
      <Button
        variant="ghost"
        onClick={() => openEditTaskDialog(taskId)}
        size="icon"
        className="h-6 w-6"
      >
        <Edit2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        onClick={() => addToSchedule(taskId)}
        size="icon"
        className="h-6 w-6"
      >
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  </div>
);
