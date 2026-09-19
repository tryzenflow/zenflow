import type { Prisma } from "../../generated/prisma";
import type {
  CreateSessionResponse,
  Session as SharedSession,
  SlotProposalFields,
  UpdateSessionResponse,
} from "@zenflow/shared";
import type { PlacementResult } from "../scheduler/types/placement.types";
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
    location: row.location,
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
    reminders: (row.reminders ?? [])
      .map((r) => r.remindBeforeMinutes)
      .sort((a, b) => b - a),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** No `SlotProposal` behind this placement (a fixed session, a series member,
 * or the fallback for `toCreateSessionResponse`/`toUpdateSessionResponse`). */
export const NO_SLOT_PROPOSAL: SlotProposalFields = {
  slotProposalId: null,
  primarySlot: null,
  alternativeSlot: null,
  divergent: false,
};

/** {@link PlacementResult} → the wire-shape `SlotProposalFields`. */
export function slotProposalFieldsOf(
  placement: PlacementResult,
): SlotProposalFields {
  return {
    slotProposalId: placement.slotProposalId,
    primarySlot: placement.scheduledStartTime?.toISOString() ?? null,
    alternativeSlot: placement.alternativeSlot?.toISOString() ?? null,
    divergent: placement.divergent,
  };
}

export function toCreateSessionResponse(
  row: SessionRow,
  slotProposal: SlotProposalFields = NO_SLOT_PROPOSAL,
): CreateSessionResponse {
  return { ...toSessionDto(row), ...slotProposal };
}

export function toUpdateSessionResponse(
  row: SessionRow,
  slotProposal: SlotProposalFields = NO_SLOT_PROPOSAL,
): UpdateSessionResponse {
  return { ...toSessionDto(row), ...slotProposal };
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
