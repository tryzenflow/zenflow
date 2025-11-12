import { addDays, endOfMonth, format, startOfMonth, startOfWeek, addMonths, subMonths } from "date-fns";
import { Schedule } from "../../types/schedule";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const MonthView = ({
  selectedDate,
  schedules,
  setSelectedDate,
}: {
  selectedDate: Date;
  schedules: Schedule[];
  setSelectedDate: (date: Date) => void;
}) => {
  const [displayMonth, setDisplayMonth] = useState(selectedDate);

  // When MonthView is mounted we hide the Sidebar mini-calendar so the
  // right-hand small calendar (the one in the sidebar) disappears for
  // this view only. We restore it on unmount so other views keep it.
  useEffect(() => {
    // Inject a temporary style that hides the MiniCalendar in the Sidebar
    // while this MonthView is mounted. This is safer than relying on
    // manipulating a specific element style (class names can vary inside
    // the Calendar component), and we clean it up on unmount.
    const styleId = "monthview-hide-minicalendar";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.innerHTML = `
        /* hide the mini calendar element used in Sidebar while MonthView is mounted */
        .w-full.bg-transparent { display: none !important; }
      `;
      document.head.appendChild(style);
    }
    return () => {
      const s = document.getElementById(styleId);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    };
  }, []);
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

  const formatKey = (d: Date) => format(d, "yyyy-MM-dd");

  return (
    <div className="flex-1 min-w-0 h-full pt-8 relative overflow-y-auto bg-background rounded-l-xl px-8 pb-8 flex flex-col">
      <div className="flex-1 flex flex-col">
        {/* Header with month navigation */}
        <div className="flex items-center justify-between mb-8">
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
            <div key={day} className="text-center text-sm font-semibold text-gray-600 py-3 border-b-2 border-gray-200">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-0 flex-1">
          {cells.map((date, idx) => {
            const inMonth = date.getMonth() === start.getMonth();
            const key = formatKey(date);
            const isSelected = selectedDate.toDateString() === date.toDateString();

            // Find schedules for this date
            const daySchedules = schedules.filter((s) => s.date === key);

            return (
              <div
                key={idx}
                onClick={() => setSelectedDate(date)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedDate(date)}
                className={`
                  flex flex-col p-3 text-xs text-foreground cursor-pointer
                  border-r border-b border-gray-200 transition-all duration-150
                  min-h-[100px]
                  ${
                    isSelected
                      ? "bg-blue-50 border-blue-300"
                      : inMonth
                        ? "bg-white hover:bg-gray-50"
                        : "bg-gray-50 text-gray-400"
                  }
                  ${idx % 7 === 6 ? "border-r-0" : ""}
                  ${Math.floor(idx / 7) === Math.floor((cells.length - 1) / 7) ? "border-b-0" : ""}
                `}
              >
                {/* Date number */}
                <div className={`font-bold mb-2 ${inMonth ? "text-gray-900" : "text-gray-400"}`}>
                  {format(date, "d")}
                </div>

                {/* Events */}
                <div className="flex flex-col gap-1 flex-1 overflow-hidden">
                  {daySchedules.slice(0, 2).map((schedule) => (
                    <div
                      key={`${schedule.task.id}-${schedule.date}`}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="text-xs bg-blue-100 text-blue-700 rounded px-2 py-1 truncate font-medium"
                    >
                      {schedule.task.title}
                    </div>
                  ))}
                  {daySchedules.length > 2 && (
                    <div className="text-xs text-gray-500 px-2">
                      +{daySchedules.length - 2} more
                    </div>
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
