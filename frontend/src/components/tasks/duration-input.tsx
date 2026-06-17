import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@/utils/constants";

const MAX_HOURS = Math.floor(DAILY_HORIZON / 60); // 24
const HOURS = Array.from({ length: MAX_HOURS + 1 }, (_, i) => i); // 0..24
const MINUTES = Array.from(
  { length: 60 / TIME_GRANULARITY },
  (_, i) => i * TIME_GRANULARITY,
); // 0, 15, 30, 45

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
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  const commit = (nextHours: number, nextMinutes: number) => {
    // Duration must stay a positive multiple of TIME_GRANULARITY.
    const total = Math.max(
      nextHours * 60 + nextMinutes,
      TIME_GRANULARITY,
    );
    onChange(total);
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        disabled={disabled}
        value={String(hours)}
        onValueChange={(v) => commit(Number(v), minutes)}
      >
        <SelectTrigger className="w-full" aria-label="Hours">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((h) => (
            <SelectItem key={h} value={String(h)}>
              {h} h
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        disabled={disabled}
        value={String(minutes)}
        onValueChange={(v) => commit(hours, Number(v))}
      >
        <SelectTrigger className="w-full" aria-label="Minutes">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {m} min
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
