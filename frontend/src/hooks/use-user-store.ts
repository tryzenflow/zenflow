import { create } from "zustand";
import { User } from "@/types/user";

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
  loading: false,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
}));
