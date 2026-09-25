import type { IntegrationStatus, IntegrationProvider } from "@zenflow/shared";
import { create } from "zustand";
import { useUserStore } from "@/hooks/use-user-store";

type State = {
  integrations: IntegrationStatus[];
  loading: boolean;
};

type Action = {
  setIntegrations: (integrations: IntegrationStatus[]) => void;
  setLoading: (loading: boolean) => void;
  updateIntegration: (provider: IntegrationProvider, status: Partial<IntegrationStatus>) => void;
};

export const useIntegrationStore = create<State & Action>((set) => ({
  integrations: [],
  loading: true,
  setIntegrations: (integrations) => set({ integrations, loading: false }),
  setLoading: (loading) => set({ loading }),
  updateIntegration: (provider, status) =>
    set((state) => ({
      integrations: state.integrations.map((i) =>
        i.provider === provider ? { ...i, ...status } : i
      ),
    })),
}));

// Per-user, like the notifications store: reset when the signed-in user changes.
useUserStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id) {
    useIntegrationStore.setState({ integrations: [], loading: true });
  }
});
