import { create } from "zustand";

/**
 * The session the user just created, so the checklist's spotlights point at
 * *that* task. Per app launch; a spotlight falls back to the first task when
 * it's unset or not on screen.
 */
export const useLastCreated = create<{
  id: string | null;
  set: (id: string | null) => void;
}>((set) => ({
  id: null,
  set: (id) => set({ id }),
}));
