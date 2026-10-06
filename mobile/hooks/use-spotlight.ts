import type { ChecklistStep } from "@zenflow/shared";
import { create } from "zustand";

/**
 * The checklist row the user tapped "show me" on. `SpotlightAnchor` (inside
 * the matching control) reacts to it and dims the screen around that control;
 * `shown` flips once an anchor has found its control, so the requester can
 * tell "nothing to point at" from "still looking".
 */
export const useSpotlight = create<{
  step: ChecklistStep | null;
  shown: boolean;
  show: (step: ChecklistStep) => void;
  markShown: () => void;
  clear: () => void;
}>((set) => ({
  step: null,
  shown: false,
  show: (step) => set({ step, shown: false }),
  markShown: () => set({ shown: true }),
  clear: () => set({ step: null, shown: false }),
}));
