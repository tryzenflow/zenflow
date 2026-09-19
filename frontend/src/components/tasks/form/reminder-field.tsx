import { useState } from "react";
import { Bell, Plus, X } from "lucide-react";
import {
  MAX_REMINDERS_PER_SESSION,
  MAX_REMINDER_MINUTES,
} from "@zenflow/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PRESETS = [15, 30, 60, 120, 1440, 10080] as const;

const UNITS = [
  { id: "min", label: "minutes", minutes: 1 },
  { id: "hour", label: "hours", minutes: 60 },
  { id: "day", label: "days", minutes: 1440 },
  { id: "week", label: "weeks", minutes: 10080 },
] as const;

/** 15 → "15 min", 60 → "1 hour", 2880 → "2 days", 10080 → "1 week". */
function leadLabel(minutes: number): string {
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes % 10080 === 0) return plural(minutes / 10080, "week");
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return `${minutes} min`;
}

const reminderLabel = (minutes: number) => `${leadLabel(minutes)} before`;

/**
 * Reminder chips for the task form: removable chips (e.g. "1 hour before")
 * plus a dashed "Add reminder" chip opening a preset picker (15 min · 30 min ·
 * 1 hour · 2 hours · 1 day · 1 week · custom). Capped at `MAX_REMINDERS_PER_SESSION`; values are minutes
 * before start, kept sorted longest-lead first.
 */
export function ReminderField({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number]["id"]>("hour");
  const full = value.length >= MAX_REMINDERS_PER_SESSION;

  const add = (minutes: number) => {
    if (value.includes(minutes) || full) return;
    onChange([...value, minutes].sort((a, b) => b - a));
    setOpen(false);
    setCustom("");
  };

  const unitMinutes = UNITS.find((u) => u.id === unit)!.minutes;
  const customMinutes = Math.round(Number(custom) * unitMinutes);
  const customError =
    custom === ""
      ? null
      : !Number.isFinite(customMinutes) || customMinutes < 1
        ? "Enter a positive number."
        : customMinutes > MAX_REMINDER_MINUTES
          ? "Up to 7 days before."
          : value.includes(customMinutes)
            ? "You already have that reminder."
            : null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((m) => (
          <span
            key={m}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/45 bg-primary/15 py-1 pr-1.5 pl-3 text-[13px] font-medium text-primary"
          >
            <Bell className="size-3.5" />
            {reminderLabel(m)}
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove reminder: ${reminderLabel(m)}`}
              onClick={() => onChange(value.filter((x) => x !== m))}
              className="inline-flex size-4 items-center justify-center rounded-full bg-current/15 hover:bg-current/25 disabled:opacity-50"
            >
              <X className="size-2.5" strokeWidth={2.5} />
            </button>
          </span>
        ))}
        {!full && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <Plus className="size-3.5" />
                Add reminder
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-3 p-3">
              <div className="grid grid-cols-3 gap-1.5">
                {PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={value.includes(m)}
                    onClick={() => add(m)}
                    className={cn(
                      "h-8 rounded-md border border-border bg-muted text-xs font-semibold text-muted-foreground transition-colors",
                      "hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                  >
                    {leadLabel(m)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] text-muted-foreground">
                  or custom
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="e.g. 2"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="h-8 w-20"
                  aria-label="Custom reminder amount"
                />
                <Select
                  value={unit}
                  onValueChange={(v) =>
                    setUnit(v as (typeof UNITS)[number]["id"])
                  }
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Custom reminder unit"
                    className="flex-1 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u.id} value={u.id} className="text-xs">
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  disabled={custom === "" || customError !== null}
                  onClick={() => add(customMinutes)}
                >
                  Add
                </Button>
              </div>
              {customError && (
                <p className="text-[11px] text-destructive">{customError}</p>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {full
          ? `${value.length} of ${MAX_REMINDERS_PER_SESSION} reminders set — remove one to add another.`
          : `Defaults to 1 hour before it starts. Up to ${MAX_REMINDERS_PER_SESSION} reminders per task.`}
      </p>
    </div>
  );
}
