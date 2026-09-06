/**
 * DLU LMS / student-portal credential integrations.
 *
 * Credentials are held server-side under two-layer envelope encryption (a
 * per-user data-encryption key, itself wrapped by a server-held master key) and
 * are never returned by any endpoint — only the connection status is.
 */

/** Which DLU system a stored credential belongs to. */
export type IntegrationProvider = "LMS" | "PORTAL";

/** Request body for `POST /integrations` — connect (or re-connect) a provider. */
export interface ConnectIntegrationInput {
  provider: IntegrationProvider;
  /** DLU account username for the chosen system. */
  username: string;
  /** DLU account password — verified with a live login before it is stored. */
  password: string;
}

/**
 * Outcome of the most recent ingestion run for a provider.
 *
 * Mirrors the backend's `JobStatus` enum, but only these four values ever reach
 * a client: the job rows behind them (per-request URLs, status codes, raw
 * response bodies, parse counts) stay backend-internal diagnostics.
 */
export type IntegrationSyncStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

/** Per-provider connection state. Carries no secret material of any kind. */
export interface IntegrationStatus {
  provider: IntegrationProvider;
  connected: boolean;
  /** ISO-8601 instant of the last successful live login, or null. */
  lastVerifiedAt: string | null;
  /**
   * ISO-8601 instant the watcher last ran for this provider, or null if it
   * never has. Derived from the newest job row — "last checked at".
   */
  lastSyncedAt: string | null;
  /** How that run ended, or null if there has never been one. */
  lastSyncStatus: IntegrationSyncStatus | null;
}

/** `data` payload for `GET /integrations` — one entry per known provider. */
export interface IntegrationStatusListResponse {
  integrations: IntegrationStatus[];
}

/** `data` payload for `POST /integrations` and `DELETE /integrations/:provider`. */
export type IntegrationStatusResponse = IntegrationStatus;
