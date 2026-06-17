import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@/utils/constants";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from(
  { length: 60 / TIME_GRANULARITY },
  (_, i) => i * TIME_GRANULARITY,
); // 0, 15, 30, 45
const MERIDIEMS = ["AM", "PM"] as const;

type Meridiem = (typeof MERIDIEMS)[number];

/** Split a minutes-of-day value into 12-hour clock parts. */
function toParts(value: number): { hour: number; minute: number; meridiem: Meridiem } {
  // Preserve the DAILY_HORIZON -> 11:59 PM edge case (see utils/time.ts).
  const clock = value === DAILY_HORIZON ? DAILY_HORIZON - 1 : value;
  const totalHours = Math.floor(clock / 60);
  const minute = clock % 60;
  const meridiem: Meridiem = totalHours >= 12 ? "PM" : "AM";
  const hour = totalHours % 12 === 0 ? 12 : totalHours % 12;
  return { hour, minute, meridiem };
}

/** Recompose 12-hour clock parts back into minutes-of-day. */
function fromParts(hour: number, minute: number, meridiem: Meridiem): number {
  const militaryHour =
    meridiem === "AM" ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  const minutes = militaryHour * 60 + minute;
  // Keep parity with timeToMinutes: 23:59 collapses onto DAILY_HORIZON.
  return minutes === DAILY_HORIZON - 1 ? DAILY_HORIZON : minutes;
}

export function TimeInput({
  value,
  onChange,
  disabled,
  className,
  start,
  end,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  start?: number;
  end?: number;
}) {
  const { hour, minute, meridiem } = toParts(value);

  const lower = start ?? 0;
  const upper = end ?? DAILY_HORIZON;

  const commit = (next: number) => {
    const clamped = Math.min(Math.max(next, lower), upper);
    onChange(clamped);
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        disabled={disabled}
        value={String(hour)}
        onValueChange={(v) => commit(fromParts(Number(v), minute, meridiem))}
      >
        <SelectTrigger className="w-full" aria-label="Hour">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((h) => (
            <SelectItem key={h} value={String(h)}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground">:</span>

      <Select
        disabled={disabled}
        value={String(minute)}
        onValueChange={(v) => commit(fromParts(hour, Number(v), meridiem))}
      >
        <SelectTrigger className="w-full" aria-label="Minute">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {m.toString().padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        disabled={disabled}
        value={meridiem}
        onValueChange={(v) => commit(fromParts(hour, minute, v as Meridiem))}
      >
        <SelectTrigger className="w-full" aria-label="AM or PM">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MERIDIEMS.map((mer) => (
            <SelectItem key={mer} value={mer}>
              {mer}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
