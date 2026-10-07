import { listIntegrations } from "@/api/integrations";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useUserStore } from "@/hooks/use-user-store";
import { type DluSyncHealth, dluSyncHealth } from "@/lib/dlu-sync-health";
import { useEffect, useMemo } from "react";

// One read per signed-in user: the store is otherwise only filled when
// Settings opens, and the day view must not wait on that screen.
let requestedFor: string | null = null;

/** Quiet DLU sync health for the day view, from the shared integration store. */
export function useDluSync(): DluSyncHealth {
  const userId = useUserStore((s) => s.user?.id ?? null);
  const loading = useIntegrationStore((s) => s.loading);
  const integrations = useIntegrationStore((s) => s.integrations);

  useEffect(() => {
    if (!userId || !loading || requestedFor === userId) return;
    requestedFor = userId;
    listIntegrations()
      .then((list) => useIntegrationStore.getState().setIntegrations(list))
      .catch(() => {
        // Stay silent: the chip is optional and Settings shows the real state.
      });
  }, [userId, loading]);

  return useMemo(
    () => (loading ? { kind: "none" } : dluSyncHealth(integrations)),
    [loading, integrations],
  );
}
