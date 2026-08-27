import * as z from "zod";
import { DAILY_HORIZON, SLOT_MINUTES, type Session } from "@zenflow/shared";

/**
 * Session validation schema — the single source of truth for the create/edit
 * session form contract, shared by `frontend/` and `mobile/` so the two clients
 * can never drift apart on what a valid session looks like (CLAUDE.md §1: the
 * shared package is the contract).
 *
 * Ported verbatim from `frontend/src/utils/sessions.ts` (RN migration Phase 5,
 * GitHub issue #20) — logic unchanged, only the import paths for the
 * duration-granularity constants moved from `frontend`'s local
 * `utils/constants.ts` duplicate to the canonical `@zenflow/shared` copy
 * (`SLOT_MINUTES`/`DAILY_HORIZON`), which both already re-export the same
 * values (`frontend/src/utils/constants.ts`'s `TIME_GRANULARITY` === 15 ===
 * `SLOT_MINUTES`).
 *
 * NOTE: `frontend/src/utils/sessions.ts` still defines its own local copy of
 * this schema rather than importing this one — the mobile RN migration session
 * that hoisted this file (#20) was scoped to `mobile/` + `packages/core/`
 * only and explicitly did not touch `frontend/`. That leaves a real (if
 * momentary) fork: this file and `frontend/src/utils/sessions.ts`'s `sessionSchema`
 * must be kept in sync by hand until a follow-up repoints `frontend/` at this
 * export too. See the mobile RN migration doc / issue #20 for the full
 * rationale.
 */
export const MAX_TITLE_LENGTH = 60;

export const sessionSchema = z.object({
  title: z
    .string()
    .min(1, { error: "Session name is required" })
    .max(MAX_TITLE_LENGTH, {
      error: `Title must be at most ${MAX_TITLE_LENGTH} characters.`,
    }),
  duration: z
    .int()
    .min(SLOT_MINUTES, {
      error: `Session duration must be at least ${SLOT_MINUTES} minutes`,
    })
    .max(DAILY_HORIZON, { error: "Session duration must be at most 24 hours" }),
  tags: z.array(z.string()).default([]),
  /**
   * Single resolved ISO-8601 instant, set by the deadline quick-action chip
   * row — required, since the view-scoped scheduling model (and its optional
   * deadline) is gone.
   */
  deadline: z
    .string()
    .min(1, { error: "Pick a deadline" })
    .refine((val) => !isNaN(Date.parse(val)), {
      error: "Invalid date format",
    }),
  note: z.string().optional(),
});

export type SessionFormValues = z.infer<typeof sessionSchema>;
export type EditSessionFormValues = SessionFormValues;

/**
 * Client-side signal for why a session's placement is unusual — the backend
 * doesn't return *why* a concrete placement was chosen, so callers derive
 * this themselves to annotate a success/conflict toast after create/update.
 * `null` when the session has no placement at all — nothing to qualify.
 *
 * There's no auto-placement engine or working-window concept anymore
 * (`User` — see `@zenflow/shared` — only carries `timezone`), so the only
 * thing left to flag is a session scheduled past its own deadline; every other
 * placement is just "onTime".
 */
export type PlacementQualifier = "onTime" | "pastDeadline";

export function placementQualifier(
  session: Session,
  user: { timezone: string },
): PlacementQualifier | null {
  if (!session.scheduledStartTime) return null;

  const start = new Date(session.scheduledStartTime);
  if (session.deadline && start > new Date(session.deadline)) return "pastDeadline";

  return "onTime";
}
