import type { User } from "@zenflow/shared";
import { create } from "zustand";

type State = {
  user: User | null;
  loading: boolean;
};

type Action = {
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
};

export const useUserStore = create<State & Action>((set) => ({
  user: null,
  // Starts true: the root layout's session-hydration effect flips it false
  // once resolved. Defaulting to false would let `AuthGate` briefly act on
  // a not-yet-hydrated `user: null` before that effect even runs.
  loading: true,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
}));
