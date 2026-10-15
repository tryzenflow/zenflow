import { create } from "zustand";
import { slotPick, undoPlacement } from "@/api/tasks";
import type { SlotPickResponse } from "@zenflow/shared";

/**
 * The alternative slot a placement proposed for one session (ADR-0022 pairwise
 * proposal). The scheduler applies the primary; the block offers the alternative
 * with its time until the user swaps or the next placement replaces it.
 */
export interface SlotAlternative {
  slotProposalId: string;
  primarySlot: string;
  alternativeSlot: string;
}

/** One session's placement fields, as a create, move or series response carries them. */
export interface PlacedSession {
  id: string;
  divergent?: boolean;
  slotProposalId?: string | null;
  primarySlot?: string | null;
  alternativeSlot?: string | null;
}

interface SlotAlternativeState {
  byId: Record<string, SlotAlternative>;
}

/** Session id to alternative. In memory only: the proposal is recorded server side. */
export const useSlotAlternativeStore = create<SlotAlternativeState>(() => ({
  byId: {},
}));

/** The alternative for `sessionId`, or undefined when none is offered. */
export function useSlotAlternative(
  sessionId: string,
): SlotAlternative | undefined {
  return useSlotAlternativeStore((s) => s.byId[sessionId]);
}

function toAlternative(session: PlacedSession): SlotAlternative | null {
  if (
    !session.divergent ||
    !session.slotProposalId ||
    !session.primarySlot ||
    !session.alternativeSlot
  ) {
    return null;
  }
  return {
    slotProposalId: session.slotProposalId,
    primarySlot: session.primarySlot,
    alternativeSlot: session.alternativeSlot,
  };
}

/**
 * Record each placed session's alternative, or clear it when that session has
 * none now. A series response also carries its sittings in `sessions`; the
 * top-level row is processed first so a sitting's own entry wins.
 */
export function rememberPlacement(
  response: PlacedSession & { sessions?: PlacedSession[] },
): void {
  const placed = [response, ...(response.sessions ?? [])];
  useSlotAlternativeStore.setState((state) => {
    const byId = { ...state.byId };
    for (const session of placed) {
      const alternative = toAlternative(session);
      if (alternative) byId[session.id] = alternative;
      else delete byId[session.id];
    }
    return { byId };
  });
}

/** Drop the alternative for `sessionId` (after a swap, or when it no longer applies). */
export function forgetAlternative(sessionId: string): void {
  useSlotAlternativeStore.setState((state) => {
    if (!(sessionId in state.byId)) return state;
    const byId = { ...state.byId };
    delete byId[sessionId];
    return { byId };
  });
}

/**
 * Apply the offered alternative in one call. Resolves to `null` when nothing
 * is offered. The entry stays on failure so the user can try again.
 */
export async function chooseOtherTime(
  sessionId: string,
): Promise<SlotPickResponse | null> {
  const alternative = useSlotAlternativeStore.getState().byId[sessionId];
  if (!alternative) return null;
  const picked = await slotPick(sessionId, {
    slotProposalId: alternative.slotProposalId,
    chose: "alternative",
  });
  forgetAlternative(sessionId);
  return picked;
}

/**
 * Undo a swap to the alternative. The server moves the session back and
 * clears the recorded pick, so the alternative is offered again.
 */
export async function undoOtherTime(
  sessionId: string,
  alternative: SlotAlternative,
  undoGroupId: string,
): Promise<void> {
  await undoPlacement(undoGroupId);
  useSlotAlternativeStore.setState((state) => ({
    byId: { ...state.byId, [sessionId]: alternative },
  }));
}
