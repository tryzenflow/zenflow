import { Check, ChevronsUpDown } from "lucide-react";
import { durationToMinutes, formatMinutes } from "../../utils/prefs";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";
import { cn } from "../../lib/utils";

const durationBlocks = Array(288)
  .fill(null)
  .map((_, i) => (i + 1) * 5);

export function DurationInput({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          disabled={disabled}
          variant="outline"
          className={cn("gap-x-3 justify-between", className)}
        >
          {formatMinutes(value)} <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <Command>
          <CommandInput placeholder="Search duration..." className="h-9" />
          <CommandList>
            {durationBlocks.map((b) => (
              <CommandItem
                value={formatMinutes(b)}
                onSelect={(value) => onChange(durationToMinutes(value))}
                key={b}
              >
                {formatMinutes(b)}
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
