import type { Prisma } from "../../generated/prisma";
import type {
  CreateSessionResponse,
  SeriesSession,
  SeriesSittingProposal,
  Session as SharedSession,
  SlotProposalFields,
  UpdateSessionResponse,
} from "@zenflow/shared";
import type {
  PlacementResult,
  SeriesPlacementRow,
} from "../scheduler/types/placement.types";
import type { SessionRow } from "./types/session-row";

/** Sort tag names for stable wire output. */
const sortedTagNames = (row: SessionRow): string[] =>
  row.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b));

/** A scheduled TASK that ends after its deadline (user accepted a late deadline). */
export function isLate(row: SessionRow): boolean {
  return (
    row.type === "TASK" &&
    row.scheduledStartTime !== null &&
    row.deadline !== null &&
    row.scheduledStartTime.getTime() + row.durationMinutes * 60_000 >
      row.deadline.getTime()
  );
}

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
    timetableGroupId: row.scheduleStudyUnitId,
    sessionIndex: row.sessionIndex,
    sessionTotal: row.sessionTotal,
    reminders: (row.reminders ?? [])
      .map((r) => r.remindBeforeMinutes)
      .sort((a, b) => b - a),
    late: isLate(row),
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
  displacedSessions: [],
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
    displacedSessions: (placement.displaced ?? []).map((d) => ({
      id: d.id,
      from: d.from.toISOString(),
      to: d.to.toISOString(),
    })),
    ...(placement.degraded ? { schedulingDegraded: true } : {}),
  };
}

/** A series sitting with no proposal / alternative to surface (#58). */
export const NO_SERIES_SITTING_PROPOSAL: SeriesSittingProposal = {
  slotProposalId: NO_SLOT_PROPOSAL.slotProposalId,
  primarySlot: NO_SLOT_PROPOSAL.primarySlot,
  alternativeSlot: NO_SLOT_PROPOSAL.alternativeSlot,
  divergent: NO_SLOT_PROPOSAL.divergent,
};

/**
 * One `sessions[]` entry of a series create / redistribute response (#58):
 * the row plus its sitting's pairwise fields from `placement`. Without a
 * placement (a sitting that wasn't re-placed) the fields are the empty
 * {@link NO_SERIES_SITTING_PROPOSAL}. `primarySlot` mirrors the row's applied
 * start (as {@link slotProposalFieldsOf} does for a single task).
 */
export function toSeriesSessionDto(
  row: SessionRow,
  placement?: SeriesPlacementRow,
): SeriesSession {
  const dto = toSessionDto(row);
  if (!placement) return { ...dto, ...NO_SERIES_SITTING_PROPOSAL };
  const slotProposalId = placement.slotProposalId ?? null;
  const divergent = placement.divergent === true && !!placement.alternativeSlot;
  return {
    ...dto,
    slotProposalId,
    primarySlot: dto.scheduledStartTime,
    alternativeSlot: divergent
      ? (placement.alternativeSlot as Date).toISOString()
      : null,
    divergent,
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
