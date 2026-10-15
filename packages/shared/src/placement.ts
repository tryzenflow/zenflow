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

export const PLACEMENT_CONTRACT_VERSION = 3;

export type PlacementPolicy = "HEURISTIC" | "LINUCB";

/**
 * Why Python chose a placed start (`services/bandit/src/core/reason.py`).
 * `PREFERRED_HOUR`: the user usually works at that hour. `ONLY_FREE_SLOT`:
 * the sole free start. `NEAR_CLASS`: next to another block.
 * `BEFORE_DEADLINE`: the default for a clean pick. `MOVED_FOR_DEADLINE`:
 * other sessions moved to fit it. `BEST_AVAILABLE`: an accepted conflict,
 * late or last-resort start.
 */
export const PLACEMENT_REASONS = [
  "PREFERRED_HOUR",
  "BEFORE_DEADLINE",
  "ONLY_FREE_SLOT",
  "NEAR_CLASS",
  "MOVED_FOR_DEADLINE",
  "BEST_AVAILABLE",
] as const;

export type PlacementReason = (typeof PLACEMENT_REASONS)[number];

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

/**
 * How firmly a flexible session holds its slot (ADR-0022). `AUTO` moves for
 * 1 plus hours moved, `CHOSEN` for 10 plus hours moved and only with the
 * user's go-ahead, `PINNED` never. Fixed sessions go in `fixed`.
 */
export type PlacementAnchor = "AUTO" | "CHOSEN" | "PINNED";

/**
 * What to do with a plan that moves a `CHOSEN` session: `ASK` answers
 * `NEEDS_CONFIRMATION`, `ALLOW` applies it (`DISPLACED`), `FORBID` treats
 * Chosen sessions as pinned.
 */
export type ChosenMovePolicy = "ASK" | "ALLOW" | "FORBID";

export interface PlacementFlexible {
  id: string;
  durationMinutes: number;
  deadlineMs: number;
  startMs: number;
  /** Default `AUTO`. */
  anchor?: PlacementAnchor;
  /** Completed sessions never move. Started ones and those starting within
   *  2 h of `nowMs` never move either; Python derives that from `startMs`. */
  completed?: boolean;
  /** Sittings of one series never share a local day after a move. */
  seriesId?: string;
}

/** Only sent on the second call of the two-phase infeasible path. */
export interface InfeasibleContext {
  policy?: "ACCEPT_CONFLICTS" | "ACCEPT_LATE_DEADLINE";
  /** Default `ASK`. */
  chosenMoves?: ChosenMovePolicy;
  flexible: PlacementFlexible[];
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
  /**
   * The cheapest displacement plan moves a `CHOSEN` session and
   * `chosenMoves` is `ASK`: `startMs` and `moves` carry the full plan, nothing
   * is applied. Resend with `chosenMoves: "ALLOW"` to apply it, `"FORBID"` to
   * decline.
   */
  | "NEEDS_CONFIRMATION"
  | "ACCEPTED_CONFLICTS"
  | "ACCEPTED_LATE"
  /**
   * PLACE only, after every other option failed: the row already exists, so it
   * gets the least-conflict start before the deadline, else the first free
   * start within the +30-day horizon, else the latest start ending by the
   * deadline (the next slot once that is past). Never returned by PREFLIGHT.
   */
  | "ACCEPTED_LAST_RESORT"
  | "INFEASIBLE";

export interface HeuristicPick {
  startMs: number;
  score: number;
}

export interface LinucbPick extends HeuristicPick {
  selectedArm: SchedulingArm;
  /** Length FEATURE_DIM (7), stored on `SlotProposal`. */
  featureVector: number[];
  /** Applied slot-score weights: LinUCB (`wL`, always 1) and the
   *  proximity-scaled stability weight (`wS`, 0 without `prevStartMs`). */
  weights: { wL: number; wS: number };
}

export interface PlacementMove {
  id: string;
  fromMs: number;
  toMs: number;
  anchor: "AUTO" | "CHOSEN";
  /** Base for the anchor, plus hours moved, plus 10 when the local day changes. */
  cost: number;
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
  /** Displacement plan (`DISPLACED`, `NEEDS_CONFIRMATION`), else `[]`. */
  moves: PlacementMove[];
  /** `ACCEPTED_LATE`, or an `ACCEPTED_LAST_RESORT` start ending after the deadline. */
  late: boolean;
  /** `ACCEPTED_CONFLICTS`, or an `ACCEPTED_LAST_RESORT` start that overlaps. */
  conflicting: boolean;
  /** Why `startMs` was chosen; `null` when there is no start. */
  reason: PlacementReason | null;
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
