import { create } from "zustand";

/** The slice of NetInfo's state we read (kept structural so tests need no native module). */
export interface NetState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

/** Unknown (null) counts as online: never claim "offline" without evidence. */
export function isOnline(s: NetState): boolean {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

interface ConnectivityState {
  /** Device-level reachability from NetInfo. */
  online: boolean;
  /** Cache keys (day / `month:…`) whose last refresh failed, so saved data is on screen. */
  staleKeys: ReadonlySet<string>;
  setOnline: (online: boolean) => void;
  setStale: (key: string, stale: boolean) => void;
  clearStale: () => void;
}

export const useConnectivity = create<ConnectivityState>((set) => ({
  online: true,
  staleKeys: new Set(),
  setOnline: (online) => set({ online }),
  setStale: (key, stale) =>
    set((s) => {
      if (s.staleKeys.has(key) === stale) return s;
      const next = new Set(s.staleKeys);
      if (stale) next.add(key);
      else next.delete(key);
      return { staleKeys: next };
    }),
  clearStale: () =>
    set((s) => (s.staleKeys.size ? { staleKeys: new Set() } : s)),
}));

/** Offline in effect: no network, or a visible refresh failed and saved data is shown.
 * A neighbouring page refreshing fine clears only its own key, never another's. */
export function selectOffline(s: ConnectivityState): boolean {
  return !s.online || s.staleKeys.size > 0;
}
