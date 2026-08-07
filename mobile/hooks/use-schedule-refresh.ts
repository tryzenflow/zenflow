import { create } from "zustand";

type State = {
  /** Monotonic counter — bumped whenever something outside a calendar screen
   * mutates that screen's tasks. */
  token: number;
};

type Action = {
  bump: () => void;
};

/**
 * Cross-screen "your tasks changed, refetch" signal.
 *
 * `OptimizeFab` used to live inside each calendar screen, so it could take an
 * `onApplied` prop wired straight to that screen's refetch. It now lives in
 * the tab bar (`components/tab-bar.tsx`), which is mounted once, outside every
 * screen — so the apply/undo result has to reach whichever screen is focused
 * through a store instead of a prop. Screens subscribe to `token` and refetch
 * when it changes.
 */
export const useScheduleRefresh = create<State & Action>((set) => ({
  token: 0,
  bump: () => set((s) => ({ token: s.token + 1 })),
}));
