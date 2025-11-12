import { addDays, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import { Schedule } from "../../types/schedule";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const YearView = ({
  selectedDate,
  schedules,
  setSelectedDate,
}: {
  selectedDate: Date;
  schedules: Schedule[];
  setSelectedDate: (date: Date) => void;
}) => {
  const [displayYear, setDisplayYear] = useState(selectedDate.getFullYear());

  const formatKey = (d: Date) => format(d, "yyyy-MM-dd");

  // Generate 12 months for the full year
  const months = Array.from({ length: 12 }, (_, i) => {
    return new Date(displayYear, i, 1);
  });

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
        <h3 className="text-lg font-bold text-gray-900 mb-2 text-center">
          {format(monthDate, "MMMM")}
        </h3>

        {/* Week headers */}
        <div className="grid grid-cols-7 gap-px mb-px">
          {["M", "T", "W", "T", "F", "S", "S"].map((day) => (
            <div
              key={day}
              className="text-center text-xs font-semibold text-gray-600 py-1"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 p-px rounded">
          {cells.map((date, idx) => {
            const inMonth = date.getMonth() === start.getMonth();
            const key = formatKey(date);
            const isSelected = selectedDate.toDateString() === date.toDateString();
            const daySchedules = schedules.filter((s) => s.date === key);

            return (
              <div
                key={idx}
                onClick={() => setSelectedDate(date)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedDate(date)}
                className={`
                  aspect-square flex items-center justify-center text-xs font-medium cursor-pointer
                  transition-all duration-150
                  ${
                    isSelected
                      ? "bg-blue-500 text-white rounded-full"
                      : inMonth
                        ? "bg-white text-gray-900 hover:bg-gray-50"
                        : "bg-gray-100 text-gray-400"
                  }
                  ${daySchedules.length > 0 && inMonth ? "font-bold text-blue-600" : ""}
                `}
              >
                {format(date, "d")}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-w-0 h-full relative overflow-y-auto bg-background rounded-l-xl p-8 flex flex-col">
      {/* Header with year navigation */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => setDisplayYear(displayYear - 1)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>

        <h2 className="text-3xl font-bold text-gray-900">{displayYear}</h2>

        <button
          onClick={() => setDisplayYear(displayYear + 1)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
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
