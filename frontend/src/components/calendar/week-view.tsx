import { format, startOfDay, startOfWeek, addDays } from "date-fns";
import { Schedule } from "../../types/schedule";
import { ScheduleItem } from "./schedule-item";
import { calculateLayout } from "../../utils/calc-layout";

export const WeekView = ({
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
    newStart: string,
    newEnd: string
  ) => void;
}) => {
  // Create an array for the hourly timeline (0 AM to 11 PM)
  const hours = Array.from({ length: 24 }, (_, i) => {
    const date = new Date(selectedDate);
    date.setHours(i, 0, 0, 0);
    return format(date, "ha").toUpperCase();
  });

  // Get the start of the week (Monday)
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  
  // Create array of 7 days for the week
  const daysOfWeek = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    const isToday = startOfDay(day).getTime() === startOfDay(new Date()).getTime();
    const isSelected = startOfDay(day).getTime() === startOfDay(selectedDate).getTime();
    
    return {
      date: day,
  dayName: format(day, "EEE"),
      dayNumber: format(day, "d"),
      isToday,
      isSelected,
      fullDate: format(day, "yyyy-MM-dd"),
    };
  });

  // Filter schedules for the entire week
  const weekStartTimestamp = startOfDay(weekStart).getTime();
  const weekEndTimestamp = weekStartTimestamp + 7 * 24 * 60 * 60 * 1000;

  const weekSchedules = schedules.filter((s) => {
    const startTimestamp = new Date(s.start!).getTime();
    return (
      startTimestamp >= weekStartTimestamp && startTimestamp < weekEndTimestamp
    );
  });

  // Group schedules by day and calculate layout for each day
  const schedulesByDay = daysOfWeek.map((dayInfo) => {
    const dayStart = startOfDay(dayInfo.date).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    
    const daySchedules = weekSchedules.filter((s) => {
      const startTimestamp = new Date(s.start!).getTime();
      return startTimestamp >= dayStart && startTimestamp < dayEnd;
    });

    return {
      ...dayInfo,
      schedules: calculateLayout(daySchedules),
    };
  });

  return (
    <div className="flex-1 min-w-0 h-full relative overflow-y-auto bg-background rounded-l-xl">
      {/* Week header with days */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="flex">
          {/* Time column header */}
          <div className="w-12 flex-shrink-0 border-r border-border py-2"></div>
          
          {/* Day headers */}
          {daysOfWeek.map((dayInfo, index) => (
            <div
              key={index}
              className="flex-1 min-w-0 py-2 px-2 text-center border-r border-border last:border-r-0"
            >
              <div className="flex flex-col items-center justify-center gap-1">
                <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                  {dayInfo.dayName}
                </div>
                <div
                  className={`text-sm font-semibold transition-all ${
                    dayInfo.isToday
                      ? "bg-primary text-primary-foreground rounded-full w-7 h-7 flex items-center justify-center shadow-sm"
                      : dayInfo.isSelected
                      ? "text-primary"
                      : "text-foreground"
                  }`}
                >
                  {dayInfo.dayNumber}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Week grid */}
      <div className="relative h-[1440px] mt-2">
        {hours.map((time, index) => (
          <div key={index} className="flex h-[60px] group">
            {/* Time label column */}
            <div className="w-12 flex-shrink-0 text-[10px] text-muted-foreground -mt-2 pr-2 text-right border-r border-border">
              {time}
            </div>
            
            {/* Day columns */}
            {daysOfWeek.map((_, dayIndex) => (
              <div key={dayIndex} className="flex-1 min-w-0 relative border-r border-border last:border-r-0">
                {/* Half-hour grid lines */}
                <div className="h-1/2 w-full absolute border-t border-border/70"></div>
                <div className="h-1/2"></div>
              </div>
            ))}
          </div>
        ))}

        {/* Render scheduled items for each day */}
        {schedulesByDay.map((dayData, dayIndex) =>
          dayData.schedules.map((schedule) => (
            <ScheduleItem
              key={`${schedule.task.id}-${schedule.date}-${schedule.split}-${dayIndex}`}
              openEditTaskDialog={openEditTaskDialog}
              deleteSchedule={deleteSchedule}
              schedule={schedule}
              updateScheduleTime={updateScheduleTime}
              isOverlapping={schedule.isOverlapping}
              columnIndex={schedule.columnIndex}
              totalColumns={schedule.totalColumns}
              dayIndex={dayIndex}
              isWeekView={true}
            />
          ))
        )}

        {/* Vertical grid lines */}
        <div className="absolute inset-y-0 left-12 w-px bg-border z-0"></div>
      </div>
    </div>
  );
};
