import type { Session } from "@zenflow/shared";

/**
 * One-shot hand-off of a divergent slot pick from the create/edit form
 * screens (`app/task/new.tsx`, `app/task/[id]/edit.tsx`) to the week view
 * (`app/(app)/index.tsx`). A divergent response must present its
 * `SlotPickSheet` over the week view — not over the modal form — so the
 * form stores the payload here and navigates; the week view's
 * `useFocusEffect` consumes it via `takePendingSlotPick` and opens its own
 * sheet. Module-scope, not persisted: a reload loses the pick recording
 * (the session itself is already saved server-side), matching the previous
 * behaviour.
 */
export interface PendingSlotPick {
  session: Session;
  primarySlot: string;
  alternativeSlot: string;
  slotProposalId: string;
  tz: string;
}

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