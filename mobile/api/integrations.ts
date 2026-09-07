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
): Promise<IntegrationStatus> {
  const { data } = await api.post("/integrations", input);
  return data.data;
}

/** Update a connected provider's stored credentials. Same live-probe rules. */
export async function updateIntegration(
  provider: IntegrationProvider,
  body: { username?: string; password?: string },
): Promise<IntegrationStatus> {
  const { data } = await api.patch(`/integrations/${provider}`, body);
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
export async function syncIntegration(
  provider: IntegrationProvider,
): Promise<IntegrationStatus> {
  const { data } = await api.post(`/integrations/${provider}/sync`);
  return data.data;
}
