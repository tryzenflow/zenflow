import type { SeriesSession } from "@zenflow/shared";

/**
 * One sitting of a `TASK` series whose heuristic-vs-LinUCB alternative can be
 * offered to the user (issue #59).
 *
 * A `sessionCount > 1` create / redistribute response carries these on
 * `sessions[]` (`SeriesSession`), never at the top level: `series.service.ts`
 * hard-sets the top-level fields to `NO_SLOT_PROPOSAL`, so the single-session
 * divergence guard in `app/task/new.tsx` can never match a series. That is
 * the whole reason this module exists.
 */
export interface DivergentSitting {
  session: SeriesSession;
  /** The proposal this sitting's pick records against (#58). */
  slotProposalId: string;
  /** ISO instant actually applied — the card pre-selected as "Scheduled". */
  primarySlot: string;
  /** The other policy's raw pick; never null on a `DivergentSitting`. */
  alternativeSlot: string;
  /** 1-based position in the series, for the "2 of 5" copy. */
  index: number;
  /** The series' total sitting count, for the same copy. */
  total: number;
}

/** A `SeriesSession` narrowed to the three fields a pick needs. */
type DivergentSession = SeriesSession & {
  slotProposalId: string;
  primarySlot: string;
  alternativeSlot: string;
};

/**
 * The sittings worth showing a picker for, soonest first.
 *
 * `divergent` alone is not enough: `session-mapper.ts` already guarantees
 * `alternativeSlot` is set whenever it is true, but `slotProposalId` is what
 * `POST /sessions/:id/slot-pick` needs — so require all three rather than
 * trusting the flag.
 *
 * Sorts by `sessionIndex` (not array order) so the full divergent set remains
 * available for bulk actions.
 */
export function divergentSittings(
  sessions: SeriesSession[] | undefined,
): DivergentSitting[] {
  if (!sessions?.length) return [];
  return sessions
    .filter(
      (s): s is DivergentSession =>
        s.divergent === true &&
        !!s.slotProposalId &&
        !!s.primarySlot &&
        !!s.alternativeSlot,
    )
    .map((session) => ({
      session,
      slotProposalId: session.slotProposalId,
      primarySlot: session.primarySlot,
      alternativeSlot: session.alternativeSlot,
      index: session.sessionIndex ?? 0,
      total: session.sessionTotal ?? 0,
     }))
     .sort((a, b) => a.index - b.index);
}

/**
 * IDs still eligible for a bulk decision (Option A — undecided only).
 *
 * A sitting whose proposal already has a recorded choice must never be
 * re-POSTed: `POST /sessions/:id/slot-pick` treats a second vote as an
 * idempotent no-op echo, so counting it as newly applied would misreport the
 * bulk result (and a "primary" re-vote would never move anything back).
 */
export function undecidedSittingIds(
  states: Array<{ id: string; decided: boolean }>,
): string[] {
  return states.filter((s) => !s.decided).map((s) => s.id);
}
