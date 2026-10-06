import type { Session } from "@zenflow/shared";
import type { DivergentSitting } from "./series-alternatives";

/**
 * One-shot hand-off of a divergent slot pick from the create/edit form
 * screens (`app/task/new.tsx`, `app/task/[id]/edit.tsx`) to the week view
 * (`app/(app)/index.tsx`). A divergent response must present its picker over
 * the week view — not over the modal form — so the form stores the payload
 * here and navigates; the week view's `useFocusEffect` consumes it via
 * {@link takePendingSlotPick} and opens its own sheet. Module-scope, not
 * persisted: a reload loses the pick recording (the sessions are already saved
 * server-side), matching the previous behaviour.
 *
 * A discriminated union rather than two parallel stores: one consume point
 * means a series payload can never be left unconsumed alongside a stale
 * single-session one.
 */
export type PendingSlotPick =
  /** A plain (non-series) `TASK` — shown as a one-sitting list in the shared sheet. */
  | {
      kind: "single";
      session: Session;
      primarySlot: string;
      alternativeSlot: string;
      slotProposalId: string;
      tz: string;
    }
  /**
   * A `sessionCount > 1` series — the multi-sitting list in the same sheet. Carries only
   * the DIVERGENT sittings, already filtered and index-sorted by
   * `divergentSittings`; the rest have no alternative to offer and are
   * deliberately not shown.
   */
  | {
      kind: "series";
      title: string;
      sittings: DivergentSitting[];
      tz: string;
    };

let pending: PendingSlotPick | null = null;

export function setPendingSlotPick(pick: PendingSlotPick): void {
  pending = pick;
}

/** Consuming read — returns the pending pick and clears it so it fires once. */
export function takePendingSlotPick(): PendingSlotPick | null {
  const p = pending;
  pending = null;
  return p;
}
