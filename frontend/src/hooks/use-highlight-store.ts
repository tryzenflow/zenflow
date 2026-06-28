import { create } from "zustand";

type State = {
  /** The task id of the block to scroll to and animate after creation. */
  highlightTaskId: string | null;
};

type Action = {
  /** Set the task id to highlight; call before triggering a refetch. */
  setHighlight: (id: string) => void;
  /** Clear the signal — called by the block after its animation ends. */
  clearHighlight: () => void;
};

export const useHighlightStore = create<State & Action>((set) => ({
  highlightTaskId: null,
  setHighlight: (id) => set({ highlightTaskId: id }),
  clearHighlight: () => set({ highlightTaskId: null }),
}));
