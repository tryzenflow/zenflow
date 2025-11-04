import { format, startOfDay } from "date-fns";
import { Schedule } from "../../types/schedule";
import { ScheduleItem } from "./schedule-item";
import { calculateLayout } from "../../utils/calc-layout";
// --- CalendarGrid Component ---

export const DayView = ({
  selectedDate,
  schedules,
  deleteSchedule,
  openEditTaskDialog,
  updateScheduleTime,
}: {
  selectedDate: Date;
  schedules: Schedule[];
  deleteSchedule: (taskId: string, date: string, split: number) => void;
  openEditTaskDialog: (taskId: string) => void;
  updateScheduleTime: (
    taskId: string,
    date: string,
    split: number,
    newStart: number,
    newEnd: number
  ) => void;
}) => {
  // Create an array for the hourly timeline (0 AM to 11 PM)
  const hours = Array.from({ length: 24 }, (_, i) => {
    const date = new Date(selectedDate);
    date.setHours(i, 0, 0, 0);
    return format(date, "ha");
  });

  // Filter schedules only for the selected date
  const selectedDayStart = startOfDay(selectedDate).getTime();
  const selectedDayEnd = selectedDayStart + 24 * 60 * 60 * 1000;

  const daySchedules = schedules.filter((s) => {
    const startTimestamp = new Date(s.start!).getTime();
    return (
      startTimestamp >= selectedDayStart && startTimestamp < selectedDayEnd
    );
  });

  // 1. Calculate the layout for the day's schedules
  const schedulesWithLayout = calculateLayout(daySchedules);

  return (
    <div className="flex-1 min-w-0 h-full pt-4 relative overflow-y-auto bg-background rounded-l-xl">
      <div className="relative h-[1440px]">
        {hours.map((time, index) => (
          <div key={index} className="flex h-[60px] group">
            {/* Time label column: w-16 matches the base offset in ScheduleItem */}
            <div className="w-12 flex-shrink-0 text-[10px] text-muted-foreground -mt-2 pr-2 text-right">
              {time}
            </div>
            {/* Grid line area */}
            <div className="flex-1 relative">
              <div className="h-1/2 w-full absolute border-t border-border/70"></div>
              <div className="h-1/2"></div>
            </div>
          </div>
        ))}

        {/* 2. Render Scheduled Items with Layout Props */}
        {schedulesWithLayout.map((schedule) => (
          <ScheduleItem
            openEditTaskDialog={openEditTaskDialog}
            deleteSchedule={deleteSchedule}
            key={`${schedule.task.id}-${schedule.date}-${schedule.split}`}
            schedule={schedule}
            updateScheduleTime={updateScheduleTime}
            isOverlapping={schedule.isOverlapping}
            columnIndex={schedule.columnIndex}
            totalColumns={schedule.totalColumns}
          />
        ))}

        {/* This creates a vertical line down the grid (needs to match time column width) */}
        {/* Adjusted left-12 to left-[3rem] (48px) to match the time column width (w-12) */}
        <div className="absolute inset-y-0 left-12 w-px bg-border z-0"></div>
      </div>
    </div>
  );
};
