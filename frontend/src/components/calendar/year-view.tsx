import {
  addDays,
  endOfMonth,
  format,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Schedule } from "../../types/schedule";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

export const YearView = ({
  selectedDate,
  schedules,
  setCurrentView,
  setSelectedDate,
}: {
  selectedDate: Date;
  schedules: Schedule[];
  setSelectedDate: (date: Date) => void;
  setCurrentView: (view: string) => void;
}) => {
  const [displayYear, setDisplayYear] = useState(selectedDate.getFullYear());

  const formatKey = (d: Date) => format(d, "yyyy-MM-dd");

  // Generate 12 months for the full year
  const months = Array.from({ length: 12 }, (_, i) => {
    return new Date(displayYear, i, 1);
  });

  useEffect(() => {
    setDisplayYear(selectedDate.getFullYear());
  }, [selectedDate]);

  const renderMonth = (monthDate: Date) => {
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);
    const firstCell = startOfWeek(start, { weekStartsOn: 1 });

    const cells: Date[] = [];
    let cursor = firstCell;
    while (cursor <= end || cells.length % 7 !== 0) {
      cells.push(cursor);
      cursor = addDays(cursor, 1);
    }

    return (
      <div key={format(monthDate, "yyyy-MM")} className="flex flex-col">
        {/* Month header */}
        <h3 className="font-semibold text-foreground mb-2 text-center">
          {format(monthDate, "MMMM")}
        </h3>

        {/* Week headers */}
        <div className="grid grid-cols-7 gap-px mb-px">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
            <div
              key={day}
              className="text-center text-xs font-semibold text-gray-600 py-1"
            >
              {day[0]}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 border-collapse bg-white mt-2 rounded">
          {cells.map((date, idx) => {
            const inMonth = date.getMonth() === start.getMonth();
            const key = formatKey(date);
            const isSelected =
              selectedDate.toDateString() === date.toDateString();
            const daySchedules = schedules.filter(
              (s) => formatKey(new Date(s.date)) === key
            );

            return (
              <div
                key={idx}
                className={cn(
                  "flex flex-col border border-border items-center p-2",
                  inMonth ? "bg-white" : "bg-muted",
                  idx === 0 && "rounded-tl-lg",
                  idx === 6 && "rounded-tr-lg",
                  idx === cells.length - 7 && "rounded-bl-lg",
                  idx === cells.length - 1 && "rounded-br-lg"
                )}
              >
                <div
                  onDoubleClick={() => {
                    setCurrentView("Day view");
                  }}
                  onClick={() => setSelectedDate(date)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedDate(date)}
                  className={cn(
                    "flex items-center justify-center text-xs font-medium w-7 h-7 rounded-full cursor-pointer transition-all duration-150",
                    inMonth ? "text-foreground" : "text-muted-foreground",
                    isSelected && "bg-primary text-white",
                    isToday(date) && !isSelected && "bg-muted"
                  )}
                >
                  {format(date, "d")}
                </div>
                {daySchedules.length > 0 && (
                  <div className="mt-0.5 flex items-center gap-0.5">
                    {Array.from(
                      new Set(daySchedules.map((s) => s.task.focus))
                    ).map((focus, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          focus === 1 && "bg-green-500",
                          focus === 2 && "bg-yellow-500",
                          focus === 3 && "bg-red-500"
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-w-0 h-full relative overflow-y-auto bg-background sm:px-4 md:px-6 lg:px-8 py-8 rounded-l-xl flex flex-col">
      {/* Header with year navigation */}
      <div className="flex items-center justify-between py-4">
        <button
          onClick={() => setDisplayYear(displayYear - 1)}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>

        <h2 className="text-2xl font-bold text-foreground">{displayYear}</h2>

        <button
          onClick={() => setDisplayYear(displayYear + 1)}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Grid of 12 months (4 rows x 3 columns) */}
      <div className="grid grid-cols-3 gap-8 flex-1 overflow-y-auto">
        {months.map((month) => renderMonth(month))}
      </div>
    </div>
  );
};
