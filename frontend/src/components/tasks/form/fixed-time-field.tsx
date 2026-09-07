import { format } from "date-fns";
import { hhmmToMinutes } from "@zenflow/core";
import { DatePicker } from "@/components/ui/datepicker";
import { TimePicker } from "@/components/ui/time-picker";

const pad = (n: number) => String(n).padStart(2, "0");
const minutesToHHMM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/**
 * Date + start-time + end-time picker for the fixed session types
 * (`ASSIGNMENT` / `EXAM` / `LECTURE` / `DND`). The form carries `date`
 * (`YYYY-MM-DD`), `startTime` / `endTime` (`HH:mm`); the submit handler derives
 * `durationMinutes` and the concrete `scheduledStartTime`. Mirrors
 * `mobile/components/tasks/form/fixed-time-field.tsx`.
 */
export function FixedTimeField({
  date,
  startTime,
  endTime,
  onChangeDate,
  onChangeStart,
  onChangeEnd,
  disabled,
}: {
  date: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  onChangeDate: (ymd: string) => void;
  onChangeStart: (hhmm: string) => void;
  onChangeEnd: (hhmm: string) => void;
  disabled?: boolean;
}) {
  const dateValue = date ? new Date(`${date}T00:00:00`) : undefined;
  const startMin = startTime ? hhmmToMinutes(startTime) : 9 * 60;
  const endMin = endTime ? hhmmToMinutes(endTime) : 10 * 60;

  return (
    <div className="space-y-2">
      <DatePicker
        className="w-full"
        placeholder="Pick a date"
        date={dateValue}
        disabled={disabled || { before: new Date() }}
        onSelect={(d) => d && onChangeDate(format(d, "yyyy-MM-dd"))}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">Starts</p>
          <TimePicker
            className="w-full"
            value={startMin}
            onChange={(m) => onChangeStart(minutesToHHMM(m))}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">Ends</p>
          <TimePicker
            className="w-full"
            value={endMin}
            onChange={(m) => onChangeEnd(minutesToHHMM(m))}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
