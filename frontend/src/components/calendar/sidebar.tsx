import { ArrowRight, Clock, X } from "lucide-react";
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
}: {
  title: string;
  duration: number;
  taskId: string;
  deleteDropoutTask: (id: string) => void;
}) => {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-b-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="flex items-center text-xs text-muted-foreground mt-0.5">
          <Clock className="h-3 w-3 mr-1" /> {formatMinutes(duration)}
        </div>
      </div>

      <Button
        variant="ghost"
        onClick={() => deleteDropoutTask(taskId)}
        size="icon"
        className="h-6 w-6"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};

export const UnscheduledTaskItem = ({
  title,
  duration,
  addToSchedule,
  taskId,
}: {
  title: string;
  duration: number;
  taskId: string;
  addToSchedule: (taskId: string) => void;
}) => (
  <div className="flex items-center justify-between py-3 border-b last:border-b-0">
    <div>
      <div className="text-sm font-medium">{title}</div>
      <div className="flex items-center text-xs text-muted-foreground mt-0.5">
        <Clock className="h-3 w-3 mr-1" /> {formatMinutes(duration)}
      </div>
    </div>

    <Button
      variant="ghost"
      onClick={() => addToSchedule(taskId)}
      size="icon"
      className="h-6 w-6"
    >
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </Button>
  </div>
);
