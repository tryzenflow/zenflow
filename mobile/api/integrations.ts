import type {
  ConnectIntegrationInput,
  IntegrationProvider,
  IntegrationStatus,
  IntegrationStatusListResponse,
} from "@zenflow/shared";
import { api } from "./base";

/** One entry per known provider (LMS, PORTAL) — connection + last-sync status. */
export async function listIntegrations(): Promise<IntegrationStatus[]> {
  const { data } = await api.get("/integrations");
  return (data.data as IntegrationStatusListResponse).integrations;
}

/**
 * Connect a provider. Probes a live login first — `400` rejects the
 * credentials, `503` means DLU is unreachable; neither writes.
 */
export async function connectIntegration(
  input: ConnectIntegrationInput,
  config?: { signal?: AbortSignal },
): Promise<IntegrationStatus> {
  const { data } = await api.post("/integrations", input, {
    signal: config?.signal,
  });
  return data.data;
}

/** Update a connected provider's stored credentials. Same live-probe rules. */
export async function updateIntegration(
  provider: IntegrationProvider,
  body: { username?: string; password?: string },
  config?: { signal?: AbortSignal },
): Promise<IntegrationStatus> {
  const { data } = await api.patch(`/integrations/${provider}`, body, {
    signal: config?.signal,
  });
  return data.data;
}

/** Disconnect a provider. Idempotent. */
export async function disconnectIntegration(
  provider: IntegrationProvider,
): Promise<IntegrationStatus> {
  const { data } = await api.delete(`/integrations/${provider}`);
  return data.data;
}

/**
 * Run this student's watchers now — the manual counterpart to the crons.
 * Resolves with the provider's status once the sync finishes.
 */
const SYNC_TIMEOUT_MS = 120_000;

export async function syncIntegration(
  provider: IntegrationProvider,
): Promise<IntegrationStatus> {
  // A sync walks DLU request by request (up to ~22 for the portal), far past
  // the client's default 8 s. The server gives up on its own at 120 s.
  const { data } = await api.post(
    `/integrations/${provider}/sync`,
    undefined,
    { timeout: SYNC_TIMEOUT_MS },
  );
  return data.data;
}
