import { t } from "./i18n";
import { combineToUtc, zonedDate } from "@zenflow/core";
import {
  BULK_TAGS_MAX,
  type CreateDndInput,
  type FocusBand,
  type Session,
  TAG_NAME_MAX,
} from "@zenflow/shared";
import { format } from "date-fns";

/**
 * Pure routing + step-state logic for first-run onboarding (issue #88).
 * RN-free so it can be unit-tested (`lib/__tests__/onboarding.test.ts`).
 */

export const ONBOARDING_STEPS = [
  "name",
  "focus",
  "dlu",
  "notifications",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const FIRST_STEP: OnboardingStep = "name";

/** Next step, clamped at "done". */
export function nextStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)];
}

/** Previous step, clamped at the first (Back is hidden there). */
export function prevStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.max(i - 1, 0)];
}

export function canGoBack(step: OnboardingStep): boolean {
  return step !== FIRST_STEP && step !== "done";
}

/** 1-based progress over the actionable steps (excludes "done"). */
export function stepProgress(step: OnboardingStep): {
  index: number;
  total: number;
} {
  return {
    index: Math.min(
      ONBOARDING_STEPS.indexOf(step) + 1,
      ONBOARDING_STEPS.length - 1,
    ),
    total: ONBOARDING_STEPS.length - 1,
  };
}

/** Where the auth gate should send the current session; null = stay put. */
export type AuthRoute = "/(auth)/login" | "/(onboarding)" | "/(app)";

export function routeForSession(
  user: { onboardedAt: string | null } | null,
  group: string,
): AuthRoute | null {
  if (!user) return group === "(auth)" ? null : "/(auth)/login";
  if (!user.onboardedAt) {
    return group === "(onboarding)" ? null : "/(onboarding)";
  }
  // Onboarded: leave the auth/onboarding groups.
  return group === "(auth)" || group === "(onboarding)" ? "/(app)" : null;
}

export const SUGGESTED_TAGS = [
  "Study",
  "Exam",
  "Assignment",
  "Project",
  "Lab",
  "Group work",
  "Reading",
  "Revision",
  "Personal",
  "Health",
  "Social",
  "Errands",
] as const;

export const DEFAULT_TICKED_TAGS: readonly string[] = SUGGESTED_TAGS.slice(
  0,
  4,
);

/** Trim + collapse whitespace; null if empty or too long. */
export function normalizeTagName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > TAG_NAME_MAX) return null;
  return name;
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Initial ticked set. Resuming (existing tags include a suggestion the user
 * already saved) keeps exactly those; otherwise the defaults, plus any other
 * existing tags (e.g. created by an LMS/portal sync during onboarding).
 */
export function initialTagSelection(existing: readonly string[]): string[] {
  const resumed = existing.some((e) =>
    SUGGESTED_TAGS.some((name) => sameTag(t(name), e)),
  );
  if (resumed) return [...existing];
  const defaults = DEFAULT_TICKED_TAGS.map((name) => t(name));
  return [
    ...defaults,
    ...existing.filter((e) => !defaults.some((d) => sameTag(d, e))),
  ];
}

/** Suggestions followed by any other (existing/custom) selected tags. */
export function tagOptions(selected: readonly string[]): string[] {
  const extras = selected.filter(
    (s) => !SUGGESTED_TAGS.some((name) => sameTag(t(name), s)),
  );
  return [...SUGGESTED_TAGS.map((name) => t(name)), ...extras];
}

export function toggleTag(selected: readonly string[], name: string): string[] {
  return selected.some((s) => sameTag(s, name))
    ? selected.filter((s) => !sameTag(s, name))
    : [...selected, name];
}

/** Add a custom tag (ticked); returns the same list if invalid or duplicate. */
export function addCustomTag(
  selected: readonly string[],
  raw: string,
): string[] {
  const name = normalizeTagName(raw);
  if (!name) return [...selected];
  const existing = SUGGESTED_TAGS.find((t) => sameTag(t, name));
  const canonical = existing ?? name;
  if (selected.some((s) => sameTag(s, canonical))) return [...selected];
  return [...selected, canonical];
}

/**
 * Names to actually POST: `selected` minus tags that already exist, so the
 * {@link BULK_TAGS_MAX} cap applies to new tags only (a user with more than
 * 50 existing tags can still add one).
 */
export function newTagsForBulk(
  selected: readonly string[],
  existing: readonly string[],
): string[] {
  return tagsForBulk(
    selected.filter((s) => {
      const n = normalizeTagName(s);
      return n !== null && !existing.some((e) => sameTag(e, n));
    }),
  );
}

/** Existing names plus `incoming` (case-insensitive dedupe, existing first). */
export function mergeTagNames(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const out = [...existing];
  for (const name of incoming) {
    if (!out.some((o) => sameTag(o, name))) out.push(name);
  }
  return out;
}

/** Names for POST /tags/bulk: deduped, capped; empty => skip the call. */
export function tagsForBulk(selected: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of selected) {
    const name = normalizeTagName(raw);
    if (name && !out.some((o) => sameTag(o, name))) out.push(name);
  }
  return out.slice(0, BULK_TAGS_MAX);
}

interface Routine {
  title: string;
  start: string;
  durationMinutes: number;
}

/** Daily do-not-disturb routines created at finish (start in user tz, minutes). */
export const DEFAULT_ROUTINES: readonly Routine[] = [
  { title: "Sleep", start: "23:00", durationMinutes: 420 },
  { title: "Lunch break", start: "11:30", durationMinutes: 60 },
  { title: "Dinner", start: "18:00", durationMinutes: 60 },
];

/**
 * Routines shifted around the onboarding focus band, so sleep and meals never
 * cover the hours the user said they focus best. No band keeps the defaults.
 */
const BAND_ROUTINES: Record<FocusBand, readonly Routine[]> = {
  MORNING: [
    { title: "Sleep", start: "22:30", durationMinutes: 450 },
    { title: "Lunch break", start: "12:00", durationMinutes: 60 },
    { title: "Dinner", start: "18:00", durationMinutes: 60 },
  ],
  AFTERNOON: [
    { title: "Sleep", start: "23:00", durationMinutes: 420 },
    { title: "Lunch break", start: "11:00", durationMinutes: 60 },
    { title: "Dinner", start: "18:00", durationMinutes: 60 },
  ],
  EVENING: [
    { title: "Sleep", start: "23:30", durationMinutes: 420 },
    { title: "Lunch break", start: "11:30", durationMinutes: 60 },
    { title: "Dinner", start: "16:00", durationMinutes: 60 },
  ],
  LATE_NIGHT: [
    { title: "Sleep", start: "02:30", durationMinutes: 450 },
    { title: "Lunch break", start: "12:30", durationMinutes: 60 },
    { title: "Dinner", start: "19:00", durationMinutes: 60 },
  ],
};

/** The routines for a focus band, or the defaults when none was chosen. */
export function routinesFor(band: FocusBand | null): readonly Routine[] {
  return band ? BAND_ROUTINES[band] : DEFAULT_ROUTINES;
}

export const DAILY_RRULE = "FREQ=DAILY";

/** `yyyy-MM-dd` shifted by whole calendar days. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * First occurrence of a daily routine as a UTC instant: today in `tz` when its
 * start is still ahead of `now`, otherwise tomorrow.
 */
export function firstRoutineStart(
  startHhmm: string,
  tz: string,
  now: Date,
): string {
  const today = format(zonedDate(now.toISOString(), tz), "yyyy-MM-dd");
  const todayStart = combineToUtc(today, startHhmm, tz);
  return Date.parse(todayStart) > now.getTime()
    ? todayStart
    : combineToUtc(addDays(today, 1), startHhmm, tz);
}

/** POST /sessions bodies for the default routines, in the user's timezone. */
export function dndRoutinePayloads(
  tz: string,
  now: Date,
  band: FocusBand | null = null,
): CreateDndInput[] {
  return routinesFor(band).map(
    (r): CreateDndInput => ({
      type: "DND",
      title: t(r.title),
      durationMinutes: r.durationMinutes,
      scheduledStartTime: firstRoutineStart(r.start, tz, now),
      rrule: DAILY_RRULE,
    }),
  );
}

/**
 * Payloads whose title is not already a recurring DND series in `existing`,
 * so a retry or re-run doesn't duplicate them.
 */
export function missingRoutines(
  payloads: readonly CreateDndInput[],
  existing: readonly Pick<Session, "type" | "title" | "rrule">[],
): CreateDndInput[] {
  return payloads.filter(
    (p) =>
      !existing.some(
        (s) => s.type === "DND" && s.rrule != null && sameTag(s.title, p.title),
      ),
  );
}

export type SetupItem = "notifications" | "dlu";

/** Steps still worth resuming from Settings, derived from real state. */
export function pendingSetupItems(state: {
  notificationsActive: boolean;
  dluConnected: boolean;
}): SetupItem[] {
  const items: SetupItem[] = [];
  if (!state.notificationsActive) items.push("notifications");
  if (!state.dluConnected) items.push("dlu");
  return items;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number>();

/**
 * Current UTC offset of an IANA zone in minutes (0 if the zone is unknown).
 * Formatters are reused and results cached per zone per hour, so filtering the
 * full zone list on every keystroke doesn't rebuild hundreds of formatters.
 */
export function utcOffsetMinutes(tz: string, at: Date = new Date()): number {
  const key = `${tz}|${Math.floor(at.getTime() / 3_600_000)}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  const value = computeUtcOffsetMinutes(tz, at);
  offsetCache.set(key, value);
  return value;
}

function computeUtcOffsetMinutes(tz: string, at: Date): number {
  try {
    let fmt = offsetFormatters.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
      offsetFormatters.set(tz, fmt);
    }
    const p = Object.fromEntries(
      fmt.formatToParts(at).map((x) => [x.type, Number(x.value)]),
    );
    const asUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

/**
 * Case-insensitive timezone search; "_" and " " are interchangeable. With
 * `near`, results are ordered by closeness to that zone (UTC-offset distance,
 * then same region, then name) instead of alphabetically, and `near` itself is
 * left out when there is no query (the UI shows it separately).
 */
export function filterTimezones(
  zones: readonly string[],
  query: string,
  limit = 50,
  near?: string,
): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  let hits = q ? zones.filter((z) => z.toLowerCase().includes(q)) : [...zones];
  if (near) {
    const now = new Date();
    const ref = utcOffsetMinutes(near, now);
    const region = near.split("/")[0];
    const dist = new Map(
      hits.map((z) => [z, Math.abs(utcOffsetMinutes(z, now) - ref)]),
    );
    hits.sort(
      (a, b) =>
        (dist.get(a) as number) - (dist.get(b) as number) ||
        Number(b.startsWith(`${region}/`)) -
          Number(a.startsWith(`${region}/`)) ||
        a.localeCompare(b),
    );
    if (!q) hits = hits.filter((z) => z !== near);
  }
  return hits.slice(0, limit);
}

/** "GMT+7", "GMT+5:30", "GMT" — derived from the offset, not Intl's shortOffset. */
export function gmtOffset(tz: string): string {
  const min = utcOffsetMinutes(tz);
  if (min === 0) return "GMT";
  const abs = Math.abs(min);
  const mm = abs % 60;
  return `GMT${min < 0 ? "-" : "+"}${Math.floor(abs / 60)}${
    mm ? `:${String(mm).padStart(2, "0")}` : ""
  }`;
}
