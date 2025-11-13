import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { cn } from "../../lib/utils";
import { Task } from "../../types/tasks";
import { useMemo, useState } from "react";

export function PrerequisitesSelect({
  selected,
  onChange,
  className,
  tasks,
  disabled,
}: {
  selected: string[];
  tasks: Task[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const taskMap = new Map(tasks.map((t) => [t.id, t.title]));
  const [q, setQ] = useState("");
  const searchedTasks = useMemo(() => {
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q.toLowerCase()) ||
        t.note?.toLowerCase().includes(q.toLowerCase())
    );
  }, [q]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          disabled={disabled}
          variant="outline"
          className={cn("gap-x-3 justify-between", className)}
        >
          {selected.length === 0
            ? "Select prerequisites"
            : selected.length === 1
            ? taskMap.get(selected[0])
            : `${selected.length} prerequisites`}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder="Search prerequisites..."
            className="h-9"
          />
          <CommandEmpty>No tasks found</CommandEmpty>
          <CommandList>
            {searchedTasks.map((task) => (
              <CommandItem value={task.id} onSelect={onChange} key={task.id}>
                {task.title}
                <Check
                  className={cn(
                    "ml-auto",
                    selected.includes(task.id) ? "opacity-100" : "opacity-0"
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
