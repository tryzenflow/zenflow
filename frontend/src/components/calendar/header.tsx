import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ViewModeSelect } from "./view-mode-select";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Dispatch, SetStateAction } from "react";
import { ViewMode } from "@/types/schedule";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedNow } from "@/utils/tz";

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
  conflictCount,
  onChanged,
  onOpenNav,
}: CalendarHeaderProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
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

        <Button variant="outline" onClick={() => setDate(zonedNow(tz))}>
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
        <div className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground md:flex">
          <span
            className={cn(
              "size-1.5 rounded-full",
              conflictCount > 0
                ? "bg-amber-500"
                : "animate-pulse bg-emerald-500",
            )}
          />
          <span>
            {conflictCount > 0
              ? `${conflictCount} conflict${conflictCount > 1 ? "s" : ""}`
              : "All tasks scheduled"}
          </span>
        </div>
        <ViewModeSelect value={currentView} onChange={setCurrentView} />
        <CreateTaskDialog date={date} view={currentView} onCreated={onChanged} />
      </div>
    </div>
  );
}
