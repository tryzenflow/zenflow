import { Separator } from "../ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  WandSparklesIcon,
  MenuIcon,
} from "lucide-react";
import { CreateTaskDialog } from "../tasks/create-task-dialog";
import { ButtonGroup } from "../ui/button-group";
import { Button } from "../ui/button";
import { NavUser } from "./nav-user";
import { Task } from "../../types/tasks";
import { SidebarTrigger } from "../ui/sidebar";

interface NavbarProps {
  selectedDate: Date;
  currentView: string;
  setCurrentView: (prev: string) => void;
  navigateDate: (dir: "next" | "prev") => void;
  goToToday: () => void;
  schedule: (scheduleDate: Date) => Promise<void>;
  isLoading: boolean;
  addTask: (task: Task) => void;
}

const VIEWS = ["Day view", "Week view", "Month view", "Year view"];

export const Navbar = ({
  selectedDate,
  currentView,
  setCurrentView,
  navigateDate,
  goToToday,
  schedule,
  addTask,
  isLoading,
}: NavbarProps) => (
  <header className="flex sm:flex-row flex-col gap-3 sm:items-center lg:w-[calc(100%-320px)] justify-between px-4 lg:px-8 py-4 border-b bg-white shadow-sm dark:bg-gray-900">
    <div className="flex justify-between items-center">
      <div>
        <div className="flex-1 font-semibold text-lg">
          {format(selectedDate, "MMM d, yyyy")}
        </div>
        <div className="text-muted-foreground font-normal text-sm">
          {format(selectedDate, "EEEE")}
        </div>
      </div>

      <ViewSelect
        currentView={currentView}
        setCurrentView={setCurrentView}
        className="sm:hidden"
      />
    </div>

    <div className="flex items-center gap-x-3">
      <ButtonGroup className="flex" aria-label="Button group">
        <Button
          variant="secondary"
          onClick={() => navigateDate("prev")}
          size="icon-sm"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="sm"
          className="hidden md:flex"
          variant="secondary"
          onClick={goToToday}
        >
          Today
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigateDate("next")}
          size="icon-sm"
        >
          <ChevronRight className="size-4" />
        </Button>
      </ButtonGroup>
      <ViewSelect
        className="hidden sm:flex"
        currentView={currentView}
        setCurrentView={setCurrentView}
      />
      <Button
        size="sm"
        disabled={isLoading}
        onClick={() => schedule(selectedDate)}
      >
        <WandSparklesIcon className="size-4" />{" "}
        <span className="hidden sm:inline">Plan</span>
      </Button>
      <Separator orientation="vertical" className="min-h-9" />
      <CreateTaskDialog
        selectedDate={selectedDate}
        addTask={async (task, scheduleDate) => {
          addTask(task);
          await schedule(scheduleDate);
        }}
      />
      <NavUser />
      <SidebarTrigger className="size-8 lg:hidden">
        <MenuIcon className="size-4" />
      </SidebarTrigger>
    </div>
  </header>
);

function ViewSelect({
  currentView,
  setCurrentView,
  className = "",
}: {
  currentView: string;
  setCurrentView: (view: string) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={className} size="sm" variant="outline">
          {currentView}
          <ChevronDown className="size-4 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={currentView}
            onValueChange={setCurrentView}
          >
            {VIEWS.map((v) => (
              <DropdownMenuRadioItem key={v} value={v}>
                {v}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="Task view">
              Task view
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
