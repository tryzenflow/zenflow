import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  endOfMonth,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import { Separator } from "@/components/ui/separator";
import { CalendarIcon } from "lucide-react";

interface DateRangeSelectProps {
  from?: Date;
  to?: Date;
  onFromChange: (date?: Date) => void;
  onToChange: (date?: Date) => void;
  placeholder?: string;
}

export function DateRangeSelect({
  from,
  to,
  onFromChange,
  onToChange,
  placeholder,
}: DateRangeSelectProps) {
  return (
    <div className="grid gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-dashed font-normal"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />

            {from ? (
              to ? (
                <>
                  {format(from, "dd/MM/yyyy")} - {format(to, "dd/MM/yyyy")}
                </>
              ) : (
                format(from, "dd/MM/yyyy")
              )
            ) : (
              <span>{placeholder ?? "Date"}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="flex w-auto py-2 px-0 space-y-3"
          align="start"
        >
          <div className="flex flex-col gap-3 px-3 pt-4">
            {[
              {
                label: "Today",
                start: startOfDay(new Date()),
                end: new Date(),
              },
              {
                label: "Last 7 days",
                start: subDays(new Date(), 6),
                end: new Date(),
              },
              {
                label: "This Month",
                start: startOfMonth(new Date()),
                end: new Date(),
              },
              {
                label: "Last Month",
                start: startOfMonth(subMonths(new Date(), 1)),
                end: endOfMonth(subMonths(new Date(), 1)),
              },
              {
                label: "Year to Date",
                start: startOfYear(new Date()),
                end: new Date(),
              },
              {
                label: "Last Year",
                start: startOfYear(subYears(new Date(), 1)),
                end: endOfYear(subYears(new Date(), 1)),
              },
            ].map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  onFromChange(preset.start);
                  onToChange(preset.end);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Separator orientation="vertical" />
          <Calendar
            mode="range"
            defaultMonth={from}
            captionLayout="dropdown"
            selected={{ from, to }}
            onSelect={(selected) => {
              onFromChange(selected?.from);
              onToChange(selected?.to);
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
