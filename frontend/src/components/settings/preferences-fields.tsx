import { Clock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** ISO weekdays (1=Mon … 7=Sun) with short labels — Monday-first. */
export const DAYS = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

/** Role archetype cold-start clusters offered during onboarding/settings. */
export const ARCHETYPES = [
  {
    id: "night-owl-dev",
    name: "Developer",
    sig: "#backend #ops",
    blurb: "Peaks mid-afternoon, avoids early mornings",
  },
  {
    id: "creative-lead",
    name: "Creative Lead",
    sig: "#marketing #copy",
    blurb: "Mornings, hard-avoids Friday afternoons",
  },
  {
    id: "finance-ops",
    name: "Finance / Ops",
    sig: "#finance #admin",
    blurb: "Structured 09–12 blocks, cutoff at 17:00",
  },
  {
    id: "generalist-pm",
    name: "Generalist PM",
    sig: "#planning #meetings",
    blurb: "Distributed across the day, high recurrence",
  },
];

/**
 * Full-day options in 15-minute steps, as minutes-from-midnight
 * (0 = 00:00 … 1425 = 23:45). 15-min matches the scheduler's slot grid.
 */
export const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => i * 15);

/** The 12 selectable hours on a 12-hour clock (1 … 12). */
export const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The four selectable minutes, matching the scheduler's 15-minute slot grid. */
export const MINUTE_OPTIONS = [0, 15, 30, 45];

/** The two selectable meridiem periods. */
export const PERIOD_OPTIONS = ["AM", "PM"] as const;

/** Format minutes-from-midnight as a 12-hour clock label, e.g. "9:00 AM". */
export function minutesToLabel(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

/**
 * Effective working minutes for a window. Wraps past midnight iff
 * `end <= start`, in which case the window runs into the next calendar day.
 */
export function workWindowMinutes(start: number, end: number) {
  return end > start ? end - start : 1440 - start + end;
}

/** Valid iff start≠end and the window covers at least 60 effective minutes. */
export function isValidWindow(start: number, end: number) {
  return start !== end && workWindowMinutes(start, end) >= 60;
}

/** True when the window crosses midnight (end on the next calendar day). */
export function windowWraps(start: number, end: number) {
  return end <= start;
}

export function TimeSelect({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const h24 = Math.floor(value / 60);
  const minute = value % 60;
  const period: (typeof PERIOD_OPTIONS)[number] = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  /** Recombine the three parts into minutes-from-midnight and emit. */
  const emit = (
    nextH12: number,
    nextMinute: number,
    nextPeriod: (typeof PERIOD_OPTIONS)[number],
  ) => {
    const base = nextH12 % 12; // 12 → 0, 1–11 → 1–11
    const nextH24 = nextPeriod === "PM" ? base + 12 : base;
    onChange(nextH24 * 60 + nextMinute);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold">{label}</label>
      <div className="flex items-center gap-2">
        <Clock className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />
        <Select
          value={String(h12)}
          onValueChange={(v) => emit(Number(v), minute, period)}
        >
          <SelectTrigger className="h-10 flex-1 bg-card text-sm font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOUR_OPTIONS.map((h) => (
              <SelectItem key={h} value={String(h)}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-semibold text-muted-foreground">:</span>
        <Select
          value={String(minute)}
          onValueChange={(v) => emit(h12, Number(v), period)}
        >
          <SelectTrigger className="h-10 flex-1 bg-card text-sm font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MINUTE_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {String(m).padStart(2, "0")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={period}
          onValueChange={(v) =>
            emit(h12, minute, v as (typeof PERIOD_OPTIONS)[number])
          }
        >
          <SelectTrigger className="h-10 flex-1 bg-card text-sm font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
