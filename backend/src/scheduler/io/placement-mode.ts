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
