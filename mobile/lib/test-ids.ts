/**
 * Stable `testID` helpers for the Maestro E2E suite (issue #79).
 *
 * Calendar task cards are addressed by their session title, slugified so a
 * test can compute the expected ID from the title it created/seeded:
 *
 *   `taskCardTestID("E2E Focus Block abc-1")`
 *   // → "calendar.taskCard.e2e-focus-block-abc-1"
 *
 * Rules (mirrored in `docs/mobile-e2e-test-flows.md` — keep them in sync):
 * - lowercase the title;
 * - every run of non-`[a-z0-9]` characters becomes a single `-`;
 * - strip leading/trailing `-`.
 *
 * Test titles must therefore be unique per run AND slug-safe: use
 * `E2E … <run-id>` with a lowercase-alphanumeric run id
 * (`mobile-e2e+<run-id>@example.test` / `E2E_RUN_ID`).
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Full `testID` for a calendar task card showing `title`. */
export function taskCardTestID(title: string): string {
  return `calendar.taskCard.${slugifyTitle(title)}`;
}
