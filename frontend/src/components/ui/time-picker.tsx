import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@/utils/constants";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTE_STEPS = Array.from(
  { length: 60 / TIME_GRANULARITY },
  (_, i) => i * TIME_GRANULARITY,
); // 0, 15, 30, 45
const MERIDIEMS = ["AM", "PM"] as const;

type Meridiem = (typeof MERIDIEMS)[number];

/** Split a minutes-of-day value into 12-hour clock parts. */
function toParts(value: number): {
  hour: number;
  minute: number;
  meridiem: Meridiem;
} {
  const clock = Math.min(Math.max(value, 0), DAILY_HORIZON);
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
  return militaryHour * 60 + minute;
}

/** Format minutes-from-midnight as a 12-hour clock label, e.g. "9:00 AM". */
export function formatMinutesOfDay(value: number): string {
  const { hour, minute, meridiem } = toParts(value);
  return `${hour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function Column({
  children,
  className,
  columnRef,
}: {
  children: React.ReactNode;
  className?: string;
  columnRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={columnRef}
      className={cn(
        "flex max-h-48 flex-col gap-0.5 overflow-y-auto scroll-py-1 pr-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ColumnButton({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-muted",
        className,
      )}
      data-active={active}
    >
      {children}
    </button>
  );
}

/**
 * Custom time-of-day picker (todo.md explicitly rejects the native
 * `<input type="time">`): a Button trigger showing the formatted time, and a
 * Popover with scrollable hour/minute columns + a segmented AM/PM toggle.
 * Value is minutes-from-midnight (0–1439), matching the scheduler's grid.
 */
export function TimePicker({
  value,
  onChange,
  disabled,
  className,
  placeholder = "Select time",
}: {
  value: number | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const parts = value !== undefined ? toParts(value) : null;
  const hourColRef = useRef<HTMLDivElement | null>(null);
  const minuteColRef = useRef<HTMLDivElement | null>(null);

  // Scroll the active hour/minute into view whenever the popover opens.
  useEffect(() => {
    if (!open) return;
    const scrollActive = (col: HTMLDivElement | null) =>
      col
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
    scrollActive(hourColRef.current);
    scrollActive(minuteColRef.current);
  }, [open]);

  const commit = (hour: number, minute: number, meridiem: Meridiem) => {
    onChange(fromParts(hour, minute, meridiem));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={!parts}
          className={cn(
            "data-[empty=true]:text-muted-foreground justify-start text-left font-normal",
            className,
          )}
        >
          <Clock />
          {parts ? formatMinutesOfDay(value!) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex gap-1.5">
          <Column columnRef={hourColRef}>
            {HOURS.map((h) => (
              <ColumnButton
                key={h}
                active={parts?.hour === h}
                onClick={() =>
                  commit(h, parts?.minute ?? 0, parts?.meridiem ?? "AM")
                }
              >
                {h}
              </ColumnButton>
            ))}
          </Column>
          <Column columnRef={minuteColRef}>
            {MINUTE_STEPS.map((m) => (
              <ColumnButton
                key={m}
                active={parts?.minute === m}
                onClick={() =>
                  commit(parts?.hour ?? 12, m, parts?.meridiem ?? "AM")
                }
              >
                {m.toString().padStart(2, "0")}
              </ColumnButton>
            ))}
          </Column>
          <div className="flex shrink-0 flex-col gap-0.5">
            {MERIDIEMS.map((mer) => (
              <ColumnButton
                key={mer}
                active={parts?.meridiem === mer}
                onClick={() =>
                  commit(parts?.hour ?? 12, parts?.minute ?? 0, mer)
                }
              >
                {mer}
              </ColumnButton>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
