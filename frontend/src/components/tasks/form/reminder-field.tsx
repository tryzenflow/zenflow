import { useState } from "react";
import { Bell, Plus, X } from "lucide-react";
import { MAX_REMINDERS_PER_SESSION } from "@zenflow/shared";
import {
  REMINDER_PRESETS,
  REMINDER_UNITS,
  customReminderMinutes,
  reminderError,
  reminderLabel,
  reminderLeadLabel,
  upsertReminder,
  type ReminderUnitId,
} from "@zenflow/core";
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

/**
 * Preset grid + custom amount/unit, shared by the "Add reminder" chip and by
 * each existing chip (tap to edit in place). `others` is every *other*
 * reminder, so a second one at the same lead time is disabled/rejected while
 * re-picking the current value is fine.
 */
function ReminderPicker({
  current,
  others,
  onPick,
}: {
  current?: number;
  others: number[];
  onPick: (minutes: number) => void;
}) {
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState<ReminderUnitId>("hour");

  const unitMinutes = REMINDER_UNITS.find((u) => u.id === unit)!.minutes;
  const customMinutes = customReminderMinutes(custom, unitMinutes);
  const customError =
    custom === "" ? null : reminderError(customMinutes, others);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {REMINDER_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={others.includes(m)}
            onClick={() => onPick(m)}
            className={cn(
              "h-8 rounded-md border border-border bg-muted text-xs font-semibold text-muted-foreground transition-colors",
              "hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40",
              m === current && "border-primary/50 bg-primary/15 text-primary",
            )}
          >
            {reminderLeadLabel(m)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] text-muted-foreground">or custom</span>
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
        <Select value={unit} onValueChange={(v) => setUnit(v as ReminderUnitId)}>
          <SelectTrigger
            size="sm"
            aria-label="Custom reminder unit"
            className="flex-1 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REMINDER_UNITS.map((u) => (
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
          onClick={() => onPick(customMinutes)}
        >
          {current === undefined ? "Add" : "Save"}
        </Button>
      </div>
      {customError && (
        <p className="text-[11px] text-destructive">{customError}</p>
      )}
    </div>
  );
}

/**
 * Reminder chips for the task form. Tap a chip (e.g. "1 hour before") to change
 * it in place, its × to remove it; a dashed "Add reminder" chip opens the same
 * picker (At start · 15 min · … · 1 week · custom). Capped at
 * `MAX_REMINDERS_PER_SESSION`; values are minutes before start, kept sorted
 * longest-lead first, and no two reminders may share a lead time.
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
  // Which popover is open: a reminder's minutes, "add", or none.
  const [openKey, setOpenKey] = useState<number | "add" | null>(null);
  const full = value.length >= MAX_REMINDERS_PER_SESSION;

  const pick = (minutes: number, replacing?: number) => {
    onChange(upsertReminder(value, minutes, replacing));
    setOpenKey(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((m) => (
          <span
            key={m}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/45 bg-primary/15 py-1 pr-1.5 pl-3 text-[13px] font-medium text-primary"
          >
            <Popover
              open={openKey === m}
              onOpenChange={(o) => setOpenKey(o ? m : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Edit reminder: ${reminderLabel(m)}`}
                  className="inline-flex items-center gap-1.5 hover:opacity-80 disabled:opacity-50"
                >
                  <Bell className="size-3.5" />
                  {reminderLabel(m)}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-3">
                <ReminderPicker
                  current={m}
                  others={value.filter((x) => x !== m)}
                  onPick={(minutes) => pick(minutes, m)}
                />
              </PopoverContent>
            </Popover>
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
          <Popover
            open={openKey === "add"}
            onOpenChange={(o) => setOpenKey(o ? "add" : null)}
          >
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
            <PopoverContent align="start" className="w-72 p-3">
              <ReminderPicker others={value} onPick={(m) => pick(m)} />
            </PopoverContent>
          </Popover>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {full
          ? `${value.length} of ${MAX_REMINDERS_PER_SESSION} reminders set — tap one to change it.`
          : `Defaults to 1 hour before it starts. Tap a reminder to change it. Up to ${MAX_REMINDERS_PER_SESSION} per task.`}
      </p>
    </div>
  );
}
