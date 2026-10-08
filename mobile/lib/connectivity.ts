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
  /** A fetch failed and the screen is showing saved data instead. */
  stale: boolean;
  setOnline: (online: boolean) => void;
  setStale: (stale: boolean) => void;
}

export const useConnectivity = create<ConnectivityState>((set) => ({
  online: true,
  stale: false,
  setOnline: (online) => set({ online }),
  setStale: (stale) =>
    set((s) => (s.stale === stale ? s : { stale })),
}));

/** Offline in effect: no network, or the server was unreachable on the last fetch. */
export function selectOffline(s: ConnectivityState): boolean {
  return !s.online || s.stale;
}
