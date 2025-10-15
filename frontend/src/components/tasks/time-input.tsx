import { Check, ChevronsUpDown } from "lucide-react";
import { minutesToTime, timeToMinutes } from "../../utils/prefs";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";
import { cn } from "../../lib/utils";
import { DAILY_HORIZON } from "../../types/prefs";

const timeBlocks = Array(289)
  .fill(null)
  .map((_, i) => i * 5);

export function TimeInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          disabled={disabled}
          variant="outline"
          className="justify-between gap-x-3"
        >
          {minutesToTime(value)}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <Command>
          <CommandInput placeholder="Search time..." className="h-9" />
          <CommandList>
            {timeBlocks.map((b) => (
              <CommandItem
                key={b}
                value={minutesToTime(b)}
                onSelect={(value) => onChange(timeToMinutes(value))}
              >
                {minutesToTime(b)}
                <Check
                  className={cn(
                    "ml-auto",
                    value === b ? "opacity-100" : "opacity-0"
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
