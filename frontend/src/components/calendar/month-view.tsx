import {
  addDays,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  addMonths,
  subMonths,
  isToday,
} from "date-fns";
import { Schedule } from "../../types/schedule";
import { MouseEvent, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { Task, TaskResponse } from "../../types/tasks";
import { TaskCard } from "../tasks/views/card";
import { getData } from "../../api";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export const MonthView = ({
  selectedDate,
  schedules,
  setSelectedDate,
  setCurrentView,
  deleteSchedule,
}: {
  selectedDate: Date;
  schedules: Schedule[];
  setSelectedDate: (date: Date) => void;
  setCurrentView: (view: string) => void;
  deleteSchedule: (
    taskId: string,
    date: string,
    split: number,
  ) => Promise<void>;
}) => {
  const [displayMonth, setDisplayMonth] = useState(selectedDate);
  const start = startOfMonth(displayMonth);
  const end = endOfMonth(displayMonth);

  // Build a simple array of dates covering full weeks in the month (Mon-start)
  const firstCell = startOfWeek(start, { weekStartsOn: 1 });
  const cells: Date[] = [];
  let cursor = firstCell;
  while (cursor <= end || cells.length % 7 !== 0) {
    cells.push(cursor);
    cursor = addDays(cursor, 1);
  }
  const [taskDetail, setTaskDetail] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [popoverDate, setPopoverDate] = useState<Date | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const formatKey = (d: Date) => format(d, "yyyy-MM-dd");

  const focusDayView = (
    e: MouseEvent<HTMLDivElement, globalThis.MouseEvent>,
    date: Date,
  ) => {
    e.stopPropagation();
    setCurrentView("Day view");
    setSelectedDate(date);
  };

  useEffect(() => {
    setDisplayMonth(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedTaskId) setTaskDetail(null);
    else
      getData<TaskResponse>(`/tasks/${selectedTaskId}`).then((res) =>
        setTaskDetail(res.data),
      );
  }, [selectedTaskId]);

  const schedulesWithoutSplits = useMemo(() => {
    return schedules.filter((schedule) => schedule.split === 0);
  }, [schedules]);

  return (
    <div className="flex-1 min-w-0 h-full pt-8 relative overflow-y-auto bg-background rounded-l-xl flex flex-col">
      <div className="flex-1 flex flex-col">
        {/* Header with month navigation */}
        <div className="flex items-center px-8 justify-between mb-8">
          <button
            onClick={() => setDisplayMonth(subMonths(displayMonth, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>

          <h3 className="text-3xl font-bold text-gray-900 flex-1 text-center">
            {format(start, "LLLL yyyy")}
          </h3>

          <button
            onClick={() => setDisplayMonth(addMonths(displayMonth, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Week headers */}
        <div className="grid grid-cols-7 gap-0 mb-0">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
            <div
              key={day}
              className="text-center text-sm font-semibold text-gray-600 py-3 border-b-2 border-gray-200"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-0 flex-1">
          {cells.map((date, idx) => {
            const inMonth = date.getMonth() === start.getMonth();
            const key = formatKey(date);
            const isSelected =
              selectedDate.toDateString() === date.toDateString();

            // Find schedules for this date
            const daySchedules = schedulesWithoutSplits.filter(
              (s) => formatKey(new Date(s.date)) === key,
            );

            return (
              <div
                key={idx}
                onClick={() => setSelectedDate(date)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedDate(date)}
                className="
                  flex flex-col p-3 text-xs text-foreground cursor-pointer
                  border-r border-b border-gray-200 transition-all duration-150
                  min-h-[100px]
                "
                onDoubleClick={(e) => focusDayView(e, date)}
              >
                {/* Date number */}
                <div
                  className={cn(
                    "font-medium mb-2 w-7 h-7 flex items-center justify-center rounded-full",
                    inMonth ? "text-foreground" : "text-muted-foreground",
                    isSelected && "text-white bg-primary",
                    isToday(date) && !isSelected && "bg-muted",
                  )}
                >
                  {format(date, "d")}
                </div>

                {/* Events */}
                <div className="flex flex-col gap-1 flex-1 overflow-hidden">
                  {daySchedules.slice(0, 2).map((schedule) => (
                    <MonthViewEvent
                      key={`${schedule.date}-${schedule.task.id}-${schedule.split}`}
                      selectedTaskId={selectedTaskId}
                      setSelectedTaskId={setSelectedTaskId}
                      popoverDate={popoverDate}
                      setPopoverDate={setPopoverDate}
                      date={date}
                      schedule={schedule}
                      inMonth={inMonth}
                      taskDetail={taskDetail}
                      deleteSchedule={deleteSchedule}
                      isPopoverOpen={isPopoverOpen}
                      isInPopover={false}
                    />
                  ))}
                  {daySchedules.length > 2 && (
                    <Popover
                      open={isPopoverOpen}
                      onOpenChange={setIsPopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <div
                          className={cn(
                            "text-xs",
                            inMonth
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {daySchedules.length - 2} more
                        </div>
                      </PopoverTrigger>
                      <PopoverContent>
                        {daySchedules.map((schedule) => (
                          <MonthViewEvent
                            key={`${schedule.date}-${schedule.task.id}-${schedule.split}`}
                            selectedTaskId={selectedTaskId}
                            setSelectedTaskId={setSelectedTaskId}
                            popoverDate={popoverDate}
                            setPopoverDate={setPopoverDate}
                            date={date}
                            schedule={schedule}
                            inMonth={inMonth}
                            taskDetail={taskDetail}
                            deleteSchedule={deleteSchedule}
                            isPopoverOpen={isPopoverOpen}
                            isInPopover
                          />
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface MonthViewEventProps {
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  popoverDate: Date | null;
  setPopoverDate: (date: Date | null) => void;
  date: Date;
  schedule: Schedule;
  inMonth: boolean;
  taskDetail: Task | null;
  deleteSchedule: (
    taskId: string,
    date: string,
    split: number,
  ) => Promise<void>;
  isInPopover: boolean;
  isPopoverOpen: boolean;
}

function MonthViewEvent({
  selectedTaskId,
  setSelectedTaskId,
  popoverDate,
  setPopoverDate,
  date,
  schedule,
  inMonth,
  taskDetail,
  deleteSchedule,
  isInPopover = false,
  isPopoverOpen = false,
}: MonthViewEventProps) {
  return (
    <Popover
      open={
        (!isPopoverOpen || isInPopover) &&
        selectedTaskId === schedule.task.id &&
        popoverDate?.toDateString() === date.toDateString()
      }
      onOpenChange={(open) => {
        if (open) {
          setSelectedTaskId(schedule.task.id);
          setPopoverDate(date);
        } else {
          setSelectedTaskId(null);
          setPopoverDate(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <div className="flex items-center gap-x-2">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              schedule.task.focus === 1 && "bg-green-500",
              schedule.task.focus === 2 && "bg-yellow-500",
              schedule.task.focus === 3 && "bg-red-500",
            )}
          />
          <div
            key={`${schedule.task.id}-${schedule.date}`}
            className={cn(
              "text-xs font-medium",
              inMonth ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {schedule.task.title}
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent asChild={!!taskDetail}>
        {taskDetail ? (
          <TaskCard task={taskDetail} deleteSchedule={deleteSchedule} />
        ) : (
          <div className="text-muted-foreground">No data available</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
