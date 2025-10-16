import { Separator } from "../ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@radix-ui/react-dropdown-menu";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  WandSparklesIcon,
} from "lucide-react";
import { CreateTaskDialog } from "../tasks/create-task-dialog";
import { ButtonGroup } from "../ui/button-group";
import { Button } from "../ui/button";
import { NavUser } from "./nav-user";

interface NavbarProps {
  selectedDate: Date;
  currentView: string;
  setCurrentView: (prev: string) => void;
  navigateDate: (dir: "next" | "prev") => void;
  goToToday: () => void;
  schedule: () => Promise<void>;
  isLoading: boolean;
}

const VIEWS = ["Day view", "Week view", "Month view", "Year view"];

export const Navbar = ({
  selectedDate,
  currentView,
  setCurrentView,
  navigateDate,
  goToToday,
  schedule,
  isLoading,
}: NavbarProps) => (
  <header className="flex items-center w-full justify-between px-4 sm:px-6 lg:px-8 py-4 border-b bg-white shadow-sm dark:bg-gray-900">
    <div className="flex-1 font-semibold text-lg">
      {format(selectedDate, "MMM d, yyyy")}
      <div className="text-muted-foreground font-normal text-sm">
        {format(selectedDate, "EEEE")}
      </div>
    </div>

    <div className="flex items-center gap-x-3">
      <ButtonGroup className="hidden sm:flex" aria-label="Button group">
        <Button
          variant="secondary"
          onClick={() => navigateDate("prev")}
          size="icon"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="secondary" onClick={goToToday}>
          Today
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigateDate("next")}
          size="icon"
        >
          <ChevronRight className="size-4" />
        </Button>
      </ButtonGroup>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="hidden sm:flex">
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
      <Button disabled={isLoading} onClick={schedule}>
        <WandSparklesIcon className="size-4" /> Schedule
      </Button>
      <Separator orientation="vertical" className="min-h-9" />
      <CreateTaskDialog />
      <NavUser />
    </div>
  </header>
);
