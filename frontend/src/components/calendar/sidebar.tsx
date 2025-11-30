import { ArrowRight, Clock, Edit2, Trash, X } from "lucide-react";
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
      className="w-full bg-transparent"
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
  split,
  taskId,
  deleteDropoutTask,
  openEditTaskDialog,
}: {
  title: string;
  split: number;
  duration: number;
  taskId: string;
  deleteDropoutTask: (id: string, split: number) => void;
  openEditTaskDialog: (taskId: string) => void;
}) => {
  return (
    <div className="flex items-center bg-transparent justify-between py-3">
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
          onClick={() => deleteDropoutTask(taskId, split)}
          size="icon"
          className="h-6 w-6"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export const TaskItem = ({
  title,
  duration,
  addToSchedule,
  openEditTaskDialog,
  deleteTask,
  taskId,
  isRecurring,
}: {
  title: string;
  duration: number;
  taskId: string;
  addToSchedule: (taskId: string) => void;
  isRecurring: boolean;
  deleteTask: (taskId: string) => void;
  openEditTaskDialog: (taskId: string) => void;
}) => (
  <div className="flex items-center justify-between py-3">
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
        onClick={() => deleteTask(taskId)}
        size="icon"
        className="h-6 w-6"
      >
        <Trash className="h-4 w-4 text-destructive" />
      </Button>
      {!isRecurring && (
        <Button
          variant="ghost"
          onClick={() => addToSchedule(taskId)}
          size="icon"
          className="h-6 w-6"
        >
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  </div>
);
