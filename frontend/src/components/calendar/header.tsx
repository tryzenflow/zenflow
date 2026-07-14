import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ViewModeSelect } from "./view-mode-select";
import { endOfWeek, format, startOfMonth } from "date-fns";
import { Dispatch, SetStateAction } from "react";
import { ViewMode } from "@/types/schedule";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedNow } from "@/utils/tz";
import { WEEK_STARTS_ON } from "@/utils/constants";
import { shiftDateByView, type NavDirection } from "@/utils/navigation";

interface CalendarHeaderProps {
  date: Date;
  setDate: Dispatch<SetStateAction<Date>>;
  currentView: ViewMode;
  setCurrentView: Dispatch<SetStateAction<ViewMode>>;
  conflictCount: number;
  onChanged: () => void;
  /** Open the mobile nav drawer (hamburger is shown only below `lg`). */
  onOpenNav?: () => void;
}

export function CalendarHeader({
  date,
  setDate,
  currentView,
  setCurrentView,
  onChanged,
  onOpenNav,
}: CalendarHeaderProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const shift = (direction: NavDirection) =>
    setDate((d) => shiftDateByView(d, currentView, direction));

  const formatByView = () => {
    switch (currentView) {
      case "day":
        return format(date, "EEE MMMM d, yyyy");
      case "week":
        return format(
          endOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }),
          "MMMM yyyy",
        );
      case "month":
        return format(startOfMonth(date), "MMMM yyyy");
    }
  };

  return (
    <div className="flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1 sm:gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={onOpenNav}
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </Button>

        <Button
          className="hidden sm:flex"
          variant="outline"
          onClick={() => setDate(zonedNow(tz))}
        >
          Today
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => shift("left")}
        >
          <ChevronLeft className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => shift("right")}
        >
          <ChevronRight className="size-4" />
        </Button>

        <h2 className="truncate text-sm font-semibold sm:text-lg">
          {formatByView()}
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <ViewModeSelect value={currentView} onChange={setCurrentView} />
        <CreateTaskDialog date={date} view={currentView} onCreated={onChanged} />
      </div>
    </div>
  );
}
