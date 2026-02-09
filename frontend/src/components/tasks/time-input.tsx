import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";
import { cn } from "../../lib/utils";
import { minutesToTime, timeToMinutes } from "@/utils/time";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@/utils/constants";

const timeBlocks = Array(DAILY_HORIZON / TIME_GRANULARITY + 1)
  .fill(null)
  .map((_, i) => i * TIME_GRANULARITY);

export function TimeInput({
  value,
  onChange,
  disabled,
  start,
  end,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  start?: number;
  end?: number;
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
            {timeBlocks
              .filter((b) => (!start || b >= start) && (!end || b <= end))
              .map((b) => (
                <CommandItem
                  key={b}
                  value={minutesToTime(b)}
                  onSelect={(value) => onChange(timeToMinutes(value))}
                >
                  {minutesToTime(b)}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === b ? "opacity-100" : "opacity-0",
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
