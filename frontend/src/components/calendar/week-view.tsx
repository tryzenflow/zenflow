import { format, startOfDay, startOfWeek, addDays } from "date-fns";
import { Schedule } from "../../types/schedule";
import { ScheduleItem } from "./schedule-item";
import { calculateLayout } from "../../utils/calc-layout";
import { cn } from "../../lib/utils";

export const WeekView = ({
  selectedDate,
  schedules,
  deleteSchedule,
  setSelectedDate,
  openEditTaskDialog,
  updateScheduleTime,
}: {
  selectedDate: Date;
  schedules: Schedule[];
  deleteSchedule: (taskId: string, date: string, split: number) => void;
  setSelectedDate: (date: Date) => void;
  openEditTaskDialog: (taskId: string) => void;
  updateScheduleTime: (
    taskId: string,
    date: string,
    split: number,
    newStart: number,
    newEnd: number,
  ) => void;
}) => {
  // Create an array for the hourly timeline (0 AM to 11 PM)
  const hours = Array.from({ length: 24 }, (_, i) => {
    const date = new Date(selectedDate);
    date.setHours(i, 0, 0, 0);
    return format(date, "ha");
  });

  // Get the start of the week (Monday)
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });

  // Create array of 7 days for the week
  const daysOfWeek = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    const isToday =
      startOfDay(day).getTime() === startOfDay(new Date()).getTime();
    const isSelected =
      startOfDay(day).getTime() === startOfDay(selectedDate).getTime();

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
  const currentHour = new Date().getHours();
  const currentMinute = new Date().getMinutes();

  return (
    <div className="flex-1 min-w-0 h-full relative overflow-y-auto bg-background">
      {/* Week header with days */}
      <div className="sticky top-0 z-20 bg-background/50 backdrop-blur">
        <div className="flex">
          {/* Time column header */}
          <div className="w-12 flex-shrink-0 py-2"></div>

          {/* Day headers */}
          {daysOfWeek.map((dayInfo, index) => (
            <div
              key={index}
              className="flex-1 relative z-15 min-w-0 py-2 text-center cursor-pointer border-l border-b border-border last:border-r-0"
              onClick={() => setSelectedDate(dayInfo.date)}
            >
              <div className="flex flex-col items-center justify-center gap-1">
                <div className="text-[10px] text-muted-foreground font-medium tracking-wide">
                  {dayInfo.dayName}
                </div>
                <div
                  className={cn(
                    "text-sm w-7 h-7 text-foreground rounded-full flex items-center justify-center font-semibold transition-all",
                    dayInfo.isSelected
                      ? "bg-primary text-primary-foreground"
                      : dayInfo.isToday && "bg-muted",
                  )}
                >
                  {dayInfo.dayNumber}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Week grid */}
      <div className="relative h-[1440px]">
        {hours.map((hour, index) => (
          <div key={index} className="flex h-[60px] group">
            {/* Time label column */}
            <div className="w-12 flex-shrink-0 z-20 text-[10px] text-muted-foreground -mt-2 pr-2 text-right border-border">
              {hour}
            </div>

            {/* Day columns */}
            {daysOfWeek.map(({ isToday }, dayIndex) => (
              <div
                key={dayIndex}
                className="flex-1 min-w-0 relative border-r border-b border-border last:border-r-0"
              >
                {/* Half-hour grid lines */}
                <div className="h-1/2 w-full absolute border-border/70"></div>
                <div className="h-1/2"></div>
                {isToday && currentHour >= index && currentHour < index + 1 && (
                  <>
                    <div
                      className="h-px bg-destructive w-full absolute z-[15]"
                      style={{
                        top: `${currentMinute * 1}px`,
                      }}
                    />
                    <div
                      className="w-2 h-2 bg-destructive rounded-full -left-1 absolute z-[15]"
                      style={{
                        top: `calc(${currentMinute * 1}px - 0.25rem)`,
                      }}
                    />
                  </>
                )}
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
          )),
        )}

        {/* Vertical grid lines */}
        <div className="absolute inset-y-0 left-12 w-px bg-border z-0"></div>
      </div>
    </div>
  );
};
