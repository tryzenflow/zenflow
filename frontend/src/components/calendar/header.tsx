import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { ViewModeSelect } from "./view-mode-select";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Dispatch, SetStateAction } from "react";
import { ViewMode } from "@/types/schedule";

interface CalendarHeaderProps {
  date: Date;
  setDate: Dispatch<SetStateAction<Date>>;
  currentView: ViewMode;
  setCurrentView: Dispatch<SetStateAction<ViewMode>>;
}

export function CalendarHeader({
  date,
  setDate,
  currentView,
  setCurrentView,
}: CalendarHeaderProps) {
  const shift = (direction: "left" | "right") => {
    switch (currentView) {
      case "day":
        setDate((d) => addDays(d, direction === "left" ? -1 : 1));
        break;
      case "week":
        setDate((d) => addWeeks(startOfWeek(d), direction === "left" ? -1 : 1));
        break;
      case "month":
        setDate((d) =>
          addMonths(startOfMonth(d), direction === "left" ? -1 : 1),
        );
        break;
    }
  };

  const formatByView = () => {
    switch (currentView) {
      case "day":
        return format(date, "EEE MMMM d, yyyy");
      case "week":
        return format(endOfWeek(date), "MMMM yyyy");
      case "month":
        return format(startOfMonth(date), "MMMM yyyy");
    }
  };

  return (
    <div className="flex items-center justify-between p-2 sm:p-4">
      <div className="flex items-center gap-2 sm:gap-4">
        <Button variant="outline" onClick={() => setDate(new Date())}>
          Today
        </Button>

        <Button variant="ghost" size="icon-sm" onClick={() => shift("left")}>
          <ChevronLeft className="size-4 text-muted-foreground" />
        </Button>

        <Button variant="ghost" size="icon-sm" onClick={() => shift("right")}>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Button>

        <h2 className="text-sm font-semibold sm:text-lg">{formatByView()}</h2>
      </div>

      <div className="flex items-center gap-2">
        <ViewModeSelect value={currentView} onChange={setCurrentView} />

        <Button size="sm">
          <Plus className="size-4" />
          <span className="sr-only sm:not-sr-only">New event</span>
        </Button>
      </div>
    </div>
  );
}
