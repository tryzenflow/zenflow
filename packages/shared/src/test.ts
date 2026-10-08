/**
 * Test-only fixture endpoints (`POST /test/*`, mounted only when
 * `NODE_ENV=test`; used by the Maestro E2E runner). The request shape lives
 * here like every other API body, so the backend DTO is the single
 * validated definition of it.
 */
export interface SeedTaskInput {
  title: string;
  type: "TASK" | "DND" | "ASSIGNMENT" | "EXAM" | "LECTURE";
  /** ISO-8601 deadline. */
  deadline: string;
  /** Positive multiple of 15 — the app's 15-minute slot grid. */
  durationMinutes: number;
  /** Total sittings; > 1 materializes one Session row per sitting. */
  sessionCount?: number;
  /**
   * ISO-8601 start slot — required: every live TASK row must have one, and
   * seeded rows bypass the placement engine, so flows assert on this slot.
   */
  scheduledStartTime: string;
}
