import { format } from "date-fns";
import { NavUser } from "../layout/nav-user";
import { DateRangeSelect } from "../common/date-range-select";

interface AnalyticsNavbarProps {
  selectedDateStart: Date;
  selectedDateEnd: Date;
  setSelectedDateStart: (date: Date) => void;
  setSelectedDateEnd: (date: Date) => void;
}

export const AnalyticsNavbar = ({
  selectedDateStart,
  selectedDateEnd,
  setSelectedDateStart,
  setSelectedDateEnd,
}: AnalyticsNavbarProps) => {
  const formattedDateStart = format(selectedDateStart, "MMM d, yyyy");
  const formattedDateEnd = format(selectedDateEnd, "MMM d, yyyy");

  return (
    <header className="px-4 sm:px-6 lg:px-8 py-4 border-b bg-white shadow-sm dark:bg-gray-900">
      <div className="max-w-7xl mx-auto flex items-center w-full justify-between ">
        <div className="flex-1 font-semibold text-lg">
          Analytics
          <div className="text-muted-foreground font-normal text-sm">
            {formattedDateStart === formattedDateEnd
              ? formattedDateStart
              : `${formattedDateStart} - ${formattedDateEnd}`}
          </div>
        </div>
        <div className="flex gap-x-3 items-center">
          <DateRangeSelect
            onFromChange={(date) =>
              setSelectedDateStart(date ? date : selectedDateStart)
            }
            onToChange={(date) =>
              setSelectedDateEnd(date ? date : selectedDateEnd)
            }
            from={selectedDateStart}
            to={selectedDateEnd}
            placeholder="Select date range"
          />
          <NavUser />
        </div>
      </div>
    </header>
  );
};
