import * as z from "zod";
import { DAILY_HORIZON, SLOT_MINUTES, type Session } from "@zenflow/shared";

/**
 * Session validation schema — the single source of truth for the create/edit
 * session form contract, consumed by `mobile/`.
 *
 * The create form is a 3-tab affair keyed on `type`:
 *
 * - **Task** — flexible study work: `duration` + `deadline`.
 * - **Fixed** (`ASSIGNMENT` / `EXAM` / `LECTURE`) — a pinned calendar event:
 *   `date` + `startTime` + `endTime` (the client derives `durationMinutes`).
 * - **Do Not Disturb** — a fixed block with an optional `rrule` recurrence.
 *
 * It is one flat object (not a discriminated union) so it wires cleanly into
 * React Hook Form; `superRefine` enforces the per-`type` required fields.
 */
export const MAX_TITLE_LENGTH = 60;

export const SESSION_FORM_TYPES = [
  "TASK",
  "ASSIGNMENT",
  "EXAM",
  "LECTURE",
  "DND",
] as const;
export type SessionFormType = (typeof SESSION_FORM_TYPES)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "HH:mm" → minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export const sessionSchema = z
  .object({
    type: z.enum(SESSION_FORM_TYPES),
    title: z
      .string()
      .min(1, { error: "Session name is required" })
      .max(MAX_TITLE_LENGTH, {
        error: `Title must be at most ${MAX_TITLE_LENGTH} characters.`,
      }),
    tags: z.array(z.string()).default([]),
    note: z.string().optional(),

    // TASK-only
    duration: z
      .int()
      .min(SLOT_MINUTES, {
        error: `Session duration must be at least ${SLOT_MINUTES} minutes`,
      })
      .max(DAILY_HORIZON, { error: "Session duration must be at most 24 hours" })
      .optional(),
    deadline: z.string().optional(),

    // Fixed / DND
    date: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),

    // DND-only
    rrule: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "TASK") {
      if (v.duration == null) {
        ctx.addIssue({
          code: "custom",
          message: "Pick a duration",
          path: ["duration"],
        });
      }
      if (!v.deadline || Number.isNaN(Date.parse(v.deadline))) {
        ctx.addIssue({
          code: "custom",
          message: "Pick a deadline",
          path: ["deadline"],
        });
      }
      return;
    }

    // Fixed types + DND
    if (!v.date || !YMD.test(v.date)) {
      ctx.addIssue({ code: "custom", message: "Pick a date", path: ["date"] });
    }
    if (!v.startTime || !HHMM.test(v.startTime)) {
      ctx.addIssue({
        code: "custom",
        message: "Pick a start time",
        path: ["startTime"],
      });
    }
    if (!v.endTime || !HHMM.test(v.endTime)) {
      ctx.addIssue({
        code: "custom",
        message: "Pick an end time",
        path: ["endTime"],
      });
      return;
    }
    if (v.startTime && HHMM.test(v.startTime)) {
      const start = hhmmToMinutes(v.startTime);
      const end = hhmmToMinutes(v.endTime);
      if (end <= start) {
        ctx.addIssue({
          code: "custom",
          message: "End time must be after start time",
          path: ["endTime"],
        });
      } else if ((end - start) % SLOT_MINUTES !== 0) {
        ctx.addIssue({
          code: "custom",
          message: `Duration must be a multiple of ${SLOT_MINUTES} minutes`,
          path: ["endTime"],
        });
      }
    }
  });

export type SessionFormValues = z.infer<typeof sessionSchema>;

/**
 * The edit form never changes `type`, so it validates the same flat shape.
 * Kept as a separate export in case the edit surface needs to diverge.
 */
export const editSessionSchema = sessionSchema;
export type EditSessionFormValues = SessionFormValues;

/**
 * Client-side signal for why a session's placement is unusual — the backend
 * doesn't return *why* a concrete placement was chosen, so callers derive
 * this themselves to annotate a success/conflict toast after create/update.
 * `null` when the session has no placement at all — nothing to qualify.
 */
export type PlacementQualifier = "onTime" | "pastDeadline";

export function placementQualifier(
  session: Session,
  _user: { timezone: string },
): PlacementQualifier | null {
  if (!session.scheduledStartTime) return null;

  const start = new Date(session.scheduledStartTime);
  if (session.deadline && start > new Date(session.deadline))
    return "pastDeadline";

  return "onTime";
}
