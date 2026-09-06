import type { 
  ConnectIntegrationInput, 
  IntegrationStatusListResponse, 
  IntegrationStatusResponse,
  IntegrationProvider 
} from "@zenflow/shared";
import { api } from "./base";

export async function getIntegrationStatus(): Promise<IntegrationStatusListResponse> {
  const { data } = await api.get("/integrations");
  return data.data;
}

export async function connectIntegration(
  input: ConnectIntegrationInput,
  config?: { signal?: AbortSignal },
): Promise<IntegrationStatusResponse> {
  const { data } = await api.post("/integrations", input, { signal: config?.signal });
  return data.data;
}

export async function disconnectIntegration(provider: IntegrationProvider): Promise<IntegrationStatusResponse> {
  const { data } = await api.delete(`/integrations/${provider}`);
  return data.data;
}