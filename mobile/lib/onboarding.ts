import { BULK_TAGS_MAX, TAG_NAME_MAX } from "@zenflow/shared";

/**
 * Pure routing + step-state logic for first-run onboarding (issue #88).
 * RN-free so it can be unit-tested (`lib/__tests__/onboarding.test.ts`).
 */

export const ONBOARDING_STEPS = [
  "language",
  "name",
  "dlu",
  "notifications",
  "timezone",
  "reminder",
  "tags",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const FIRST_STEP: OnboardingStep = "language";

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

/** Initial ticked set: the user's existing tags if any (resume), else the defaults. */
export function initialTagSelection(existing: readonly string[]): string[] {
  return existing.length > 0 ? [...existing] : [...DEFAULT_TICKED_TAGS];
}

/** Suggestions followed by any other (existing/custom) selected tags. */
export function tagOptions(selected: readonly string[]): string[] {
  const extras = selected.filter(
    (s) => !SUGGESTED_TAGS.some((t) => sameTag(t, s)),
  );
  return [...SUGGESTED_TAGS, ...extras];
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

/** Names for POST /tags/bulk: deduped, capped; empty => skip the call. */
export function tagsForBulk(selected: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of selected) {
    const name = normalizeTagName(raw);
    if (name && !out.some((o) => sameTag(o, name))) out.push(name);
  }
  return out.slice(0, BULK_TAGS_MAX);
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

/** Case-insensitive timezone search; "_" and " " are interchangeable. */
export function filterTimezones(
  zones: readonly string[],
  query: string,
  limit = 50,
): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  const hits = q
    ? zones.filter((z) => z.toLowerCase().includes(q))
    : [...zones];
  return hits.slice(0, limit);
}
