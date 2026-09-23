/**
 * Internal wire contract between the NestJS backend and the Python bandit
 * service's `POST /v1/place` (`docs/adr/0003-python-authoritative-placement.md`
 * section 3). JSON, camelCase, epoch-ms integers for instants (ISO only for the
 * local `dayStr`). Not used by the FE/mobile. The Pydantic models in
 * `services/bandit/src/schemas_place.py` mirror these types; both sides are
 * checked against `packages/shared/contract/place/*.json`.
 *
 * Additive-only within a major (`/v1`); bump `PLACEMENT_CONTRACT_VERSION` only
 * for a minor-compatible extension the service must recognise.
 */
import type { SchedulingArm } from "./bandit";

export const PLACEMENT_CONTRACT_VERSION = 1;

export type PlacementPolicy = "HEURISTIC" | "LINUCB";

/**
 * Per-type load already on a day. Value shape is `{ hours, count }` (the shape
 * `day-load.ts` produces and the context vector consumes); the ADR sketch
 * wrote a bare minutes number, but the numpy context builder needs both the
 * hours and the count, so the richer shape is the contract.
 * Keys = `WorkloadType` in the backend (`LECTURE|ASSIGNMENT|EXAM|TASK|DND`).
 */
export type PlacementWorkloadByType = Record<
  "LECTURE" | "ASSIGNMENT" | "EXAM" | "TASK" | "DND",
  { hours: number; count: number }
>;

export interface IntervalMs {
  startMs: number;
  endMs: number;
}

export interface PlacementDay {
  /** Local 'YYYY-MM-DD'. */
  dayStr: string;
  /** Local midnight (UTC epoch ms). */
  dayStartMs: number;
  /** Next local midnight, exclusive. */
  dayEndMs: number;
  /** Includes lookahead past `dayEndMs` for straddling blocks. */
  occupied: IntervalMs[];
  workloadByType: PlacementWorkloadByType;
}

export interface PlacementMember {
  /** Real session id, or `"__preflight__-<i>"`. */
  id: string;
  /** Positive multiple of 15. */
  durationMinutes: number;
  /** Stability anchor (edit path). */
  prevStartMs?: number;
  /** Nest's A/B roll for THIS member. */
  primaryPolicy: PlacementPolicy;
  /** `true` => also return the non-primary pick (pairwise sample). */
  computeBoth: boolean;
}

/** Only sent on the second call of the two-phase infeasible path. */
export interface InfeasibleContext {
  policy?: "ACCEPT_CONFLICTS" | "ACCEPT_LATE_DEADLINE";
  flexible: {
    id: string;
    durationMinutes: number;
    deadlineMs: number;
    startMs: number;
  }[];
  /** Deadline day +/- 1. */
  fixed: IntervalMs[];
  /** `now .. deadline + 30d`, for the fallback slot pickers. */
  horizonOccupied: IntervalMs[];
}

export interface PlaceRequest {
  contractVersion: number;
  /** uuid; log/trace correlation. Second call of the two-phase path appends `-2`. */
  requestId: string;
  /** `PREFLIGHT`: feasibility only, no proposals needed. */
  mode: "PLACE" | "PREFLIGHT";
  nowMs: number;
  /** IANA. */
  timezone: string;
  deadlineMs: number;
  /** Load-scope decision owned by Nest (single 30, series 60). */
  maxScanDays: number;
  /** Length 1 = single TASK; >1 = one materialized series. */
  members: PlacementMember[];
  /** e.g. a series' already-started sittings. */
  fixedOccupied: IntervalMs[];
  /** Loaded once for the whole scan range. */
  days: PlacementDay[];
  /** `preferenceMatrix` = 168 floats (7 ISO weekdays x 24 hours, row-major). */
  user: { preferenceMatrix: number[]; observationCount: number };
  /** Required iff any member can run LINUCB. `[]` = cold prior. */
  bandit?: {
    alpha: number;
    ridge: number;
    state: Record<SchedulingArm, { A: number[]; b: number[] }>;
  };
  infeasible?: InfeasibleContext;
}

export type PlacementOutcome =
  | "PLACED"
  | "NEEDS_INFEASIBLE_CONTEXT"
  | "DISPLACED"
  | "ACCEPTED_CONFLICTS"
  | "ACCEPTED_LATE"
  | "INFEASIBLE";

export interface HeuristicPick {
  startMs: number;
  score: number;
}

export interface LinucbPick extends HeuristicPick {
  selectedArm: SchedulingArm;
  /** Length FEATURE_DIM (22), stored on `SlotProposal`. */
  featureVector: number[];
  /** Applied slot-score weights: LinUCB (`wL`, always 1) and the
   *  proximity-scaled stability weight (`wS`, 0 without `prevStartMs`). */
  weights: { wL: number; wS: number };
}

export interface PlacedMember {
  id: string;
  outcome: PlacementOutcome;
  /** What Python used to update the sibling ledger. */
  appliedPolicy: PlacementPolicy | "NONE";
  /** Present iff requested/primary. */
  heuristic: HeuristicPick | null;
  /** Present iff requested/primary and bandit state given. */
  linucb: LinucbPick | null;
  /** Python's recommended start for the primary policy. */
  startMs: number | null;
  /** Displacement, else `[]`. */
  moves: { id: string; fromMs: number; toMs: number }[];
  /** `ACCEPTED_LATE`. */
  late: boolean;
  /** `ACCEPTED_CONFLICTS`. */
  conflicting: boolean;
}

export interface PlaceResponse {
  contractVersion: number;
  requestId: string;
  /** Constants hash -> `SlotProposal.modelVersion`. */
  paramsVersion: string;
  /** Same order as `request.members`. */
  results: PlacedMember[];
  timingsMs: {
    decode: number;
    context: number;
    predict: number;
    scan: number;
    displace: number;
    total: number;
  };
}

/** Error body of a non-2xx `/v1/place` (422 `CONTRACT_VERSION`, 401, ...). */
export interface PlaceErrorBody {
  code?: "CONTRACT_VERSION" | string;
  detail?: unknown;
}

/** Shape of a `packages/shared/contract/place/*.json` fixture file. */
export interface PlaceContractFixture {
  name: string;
  description: string;
  /**
   * Response fields a consumer must NOT compare (nondeterministic or
   * environment-derived): `paramsVersion`, `timingsMs`.
   */
  ignore: ("paramsVersion" | "timingsMs")[];
  request: PlaceRequest;
  response: PlaceResponse;
}
