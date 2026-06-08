import { ChevronDown, Clock } from "lucide-react";

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

/** Half-hour options between 05:00 and 22:00, as minutes-from-midnight. */
export const TIME_OPTIONS = Array.from(
  { length: (22 - 5) * 2 + 1 },
  (_, i) => 5 * 60 + i * 30,
);

/** Format minutes-from-midnight as a 12-hour clock label, e.g. "9:00 AM". */
export function minutesToLabel(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
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
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold">{label}</label>
      <div className="relative">
        <Clock className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-10 w-full appearance-none rounded-md border border-border bg-card pl-9 pr-9 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {TIME_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {minutesToLabel(m)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}
