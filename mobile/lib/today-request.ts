import { create } from "zustand";

/**
 * The Today tab is an action, not a screen: pressing it bumps `nonce` and the
 * calendar answers by showing today in Day view, whatever view it was on.
 */
export const useTodayRequest = create<{ nonce: number; request: () => void }>(
  (set) => ({
    nonce: 0,
    request: () => set((s) => ({ nonce: s.nonce + 1 })),
  }),
);
