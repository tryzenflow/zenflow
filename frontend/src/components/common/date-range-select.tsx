import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addDays,
  addYears,
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
import type { DateRange, Matcher } from "react-day-picker";

export interface DateRangePreset {
  label: string;
  start: Date;
  end: Date;
}

const DEFAULT_PRESETS: DateRangePreset[] = [
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
];

interface DateRangeSelectProps {
  from?: Date;
  to?: Date;
  onFromChange: (date?: Date) => void;
  onToChange: (date?: Date) => void;
  placeholder?: string;
  /** Override the default (mostly past-oriented) quick-pick presets. */
  presets?: DateRangePreset[];
  /** Disable every day strictly before this date (e.g. "no past dates"). */
  disabledBefore?: Date;
  /** Once `from` is picked, disable days more than this many days after it. */
  maxRangeDays?: number;
  /** Earliest month the calendar can navigate/dropdown to. */
  startMonth?: Date;
  /** Latest month the calendar can navigate/dropdown to. Defaults far enough
   * into the future that "no upper bound" reads as unbounded in practice. */
  endMonth?: Date;
}

export function DateRangeSelect({
  from,
  to,
  onFromChange,
  onToChange,
  placeholder,
  presets = DEFAULT_PRESETS,
  disabledBefore,
  maxRangeDays,
  startMonth = subYears(new Date(), 20),
  endMonth = addYears(new Date(), 20),
}: DateRangeSelectProps) {
  const disabled: Matcher[] = [];
  if (disabledBefore) disabled.push({ before: disabledBefore });
  if (from && maxRangeDays !== undefined) {
    disabled.push({ after: addDays(from, maxRangeDays) });
  }

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
            {presets.map((preset) => (
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
            startMonth={startMonth}
            endMonth={endMonth}
            disabled={disabled.length ? disabled : undefined}
            selected={{ from, to } as DateRange}
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
