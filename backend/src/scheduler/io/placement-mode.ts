/**
 * `SCHEDULER_PLACEMENT_MODE` (ADR-0003 section 7): `legacy` = today's TS
 * ranking (default), `shadow` = legacy plus a non-blocking `/v1/place` call
 * whose diff is logged, `python` = Python-authoritative with the frozen TS
 * fallback.
 */
export type PlacementMode = "legacy" | "shadow" | "python";

export const PLACEMENT_MODES: readonly PlacementMode[] = [
  "legacy",
  "shadow",
  "python",
];

export function parsePlacementMode(raw: string | undefined): PlacementMode {
  return PLACEMENT_MODES.includes(raw as PlacementMode)
    ? (raw as PlacementMode)
    : "legacy";
}

/** Why a placement was served by the frozen TS fallback (`SlotProposal.degradedReason`). */
export type DegradedReason =
  | "timeout"
  | "breaker_open"
  | "connect"
  | "http_5xx"
  | "http_4xx"
  | "version"
  | "invalid_response"
  | "disabled";
