import { setLanguage } from "@/lib/i18n";
import { useConnectivity } from "@/lib/connectivity";
import { cacheSessionUser } from "@/lib/session";
import { attachSessionDisk, hydrateSessionCache } from "@/lib/session-cache";
import { sessionDisk } from "@/lib/session-store";
import type { User } from "@zenflow/shared";
import { create } from "zustand";

type State = {
  user: User | null;
  loading: boolean;
};

type Action = {
  setUser: (user: User | null) => void;
  /** Server-returned user (PATCH response): set it and refresh the native session cache. */
  updateUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
};

// Offline calendar: persist fetched days to disk and reload them per user.
attachSessionDisk(sessionDisk);

export const useUserStore = create<State & Action>((set) => ({
  user: null,
  // Starts true: the root layout's session-hydration effect flips it false
  // once resolved. Defaulting to false would let `AuthGate` briefly act on
  // a not-yet-hydrated `user: null` before that effect even runs.
  loading: true,
  setUser: (user) => {
    if (user) setLanguage(user.lang);
    hydrateSessionCache(user?.id ?? null);
    if (!user) useConnectivity.getState().setStale(false);
    set({ user });
  },
  updateUser: (user) => {
    setLanguage(user.lang);
    set({ user });
    // Cold-start fallback cache; best-effort.
    void cacheSessionUser(user).catch(() => {});
  },
  setLoading: (loading) => set({ loading }),
}));
