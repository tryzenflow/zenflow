import type { IntegrationStatus } from "@zenflow/shared";

/** A clean sync older than this reads as "behind" in the day view. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type DluSyncHealth =
  | { kind: "none" } // nothing connected, or not known yet
  | { kind: "ok" }
  | { kind: "stale"; lastSuccessAt: string }
  | { kind: "failing"; lastSuccessAt: string | null };

/**
 * Collapse the per-provider integration statuses into one day-view signal.
 * Only connected providers count; failing beats stale beats ok. A provider that
 * has never synced is not reported as stale (there is nothing to be behind).
 */
export function dluSyncHealth(
  integrations: readonly IntegrationStatus[],
  now: number = Date.now(),
): DluSyncHealth {
  const connected = integrations.filter((i) => i.connected);
  if (connected.length === 0) return { kind: "none" };
  const failing = connected.find(
    (i) => i.failing || i.lastSyncStatus === "FAILED",
  );
  if (failing) return { kind: "failing", lastSuccessAt: failing.lastSuccessAt };
  const stale = connected
    .filter(
      (i) => i.lastSuccessAt && now - Date.parse(i.lastSuccessAt) > STALE_AFTER_MS,
    )
    .sort((a, b) => Date.parse(a.lastSuccessAt!) - Date.parse(b.lastSuccessAt!))[0];
  if (stale?.lastSuccessAt)
    return { kind: "stale", lastSuccessAt: stale.lastSuccessAt };
  return { kind: "ok" };
}
