import type { Prisma } from "../../generated/prisma";
import type { Session as SharedSession } from "@zenflow/shared";
import type { SessionRow } from "./types/session-row";

/** Sort tag names for stable wire output. */
const sortedTagNames = (row: SessionRow): string[] =>
  row.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b));

/** Map a Prisma `Session` row to the `@zenflow/shared` API shape (dates → ISO). */
export function toSessionDto(row: SessionRow): SharedSession {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    durationMinutes: row.durationMinutes,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    type: row.type,
    source: row.source,
    tags: sortedTagNames(row),
    scheduledStartTime: row.scheduledStartTime
      ? row.scheduledStartTime.toISOString()
      : null,
    seriesId: row.seriesId,
    rrule: row.series?.rrule ?? null,
    sessionIndex: row.sessionIndex,
    sessionTotal: row.sessionTotal,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The `{ scheduledStartTime, durationMinutes, type, tags }` snapshot stored on a
 * `SessionEvent` (`CREATE` / `RETAINED`). */
export function toSessionSnapshot(row: SessionRow): Prisma.InputJsonValue {
  return {
    scheduledStartTime: row.scheduledStartTime
      ? row.scheduledStartTime.toISOString()
      : null,
    durationMinutes: row.durationMinutes,
    type: row.type,
    tags: sortedTagNames(row),
  };
}
