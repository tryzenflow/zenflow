import { listIntegrations } from "@/api/integrations";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useUserStore } from "@/hooks/use-user-store";
import { useEffect } from "react";

let inflight: Promise<void> | null = null;

/**
 * Whether any campus account (LMS or portal) is connected: null until the
 * status is known, so a screen outside Settings never offers "connect" to
 * someone who already has. Loads the status itself the first time it is needed;
 * every instance shares one request.
 */
export function useDluConnected(): boolean | null {
  const userId = useUserStore((s) => s.user?.id);
  const loading = useIntegrationStore((s) => s.loading);
  const connected = useIntegrationStore((s) =>
    s.integrations.some((i) => i.connected),
  );

  useEffect(() => {
    if (!userId || !loading || inflight) return;
    inflight = listIntegrations()
      .then((list) => useIntegrationStore.getState().setIntegrations(list))
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
  }, [userId, loading]);

  return loading ? null : connected;
}
