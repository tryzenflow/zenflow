import {
  PLACEMENT_NEEDS_CONFIRMATION_CODE,
  type PlacementPlan,
  type PlacementPlanMove,
  type Session,
} from "@zenflow/shared";
import { isAxiosError } from "axios";

/** The plan from a 409 NEEDS_CONFIRMATION body, else null. */
export function getPlacementPlan(error: unknown): PlacementPlan | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const body = error.response.data as {
    code?: string;
    data?: { plan?: PlacementPlan };
  };
  return body?.code === PLACEMENT_NEEDS_CONFIRMATION_CODE && body.data?.plan
    ? body.data.plan
    : null;
}

/** One row of a before or after timeline. */
export interface RoomRow {
  id: string;
  title: string;
  /** ISO-8601 start in this timeline. */
  start: string;
  durationMinutes: number;
  /** True for a session the plan moves; false for the session being placed. */
  moved: boolean;
}

export interface RoomTimelines {
  before: RoomRow[];
  after: RoomRow[];
}

const FALLBACK_DURATION = 60;

/**
 * Before and after rows of a plan, in start order. `before` shows where each
 * moved session sits now; `after` shows where the plan puts it, and the
 * session being placed at `plan.start`. `newTitle` names that session when it
 * is a create (`plan.sessionId` null); for a move, its title comes from
 * `sessions`.
 */
export function roomTimelines(
  plan: PlacementPlan,
  sessions: Session[],
  newTitle: string,
  newDurationMinutes: number,
): RoomTimelines {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const durationOf = (id: string) => byId.get(id)?.durationMinutes ?? FALLBACK_DURATION;
  const titleOf = (id: string) => byId.get(id)?.title ?? "";

  const moved = (move: PlacementPlanMove, at: "from" | "to"): RoomRow => ({
    id: move.id,
    title: titleOf(move.id),
    start: move[at],
    durationMinutes: durationOf(move.id),
    moved: true,
  });

  const placed: RoomRow = {
    id: plan.sessionId ?? "new",
    title: plan.sessionId ? titleOf(plan.sessionId) : newTitle,
    start: plan.start,
    durationMinutes: plan.sessionId ? durationOf(plan.sessionId) : newDurationMinutes,
    moved: false,
  };

  const order = (rows: RoomRow[]) =>
    [...rows].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  // A move plan places a session that already has a slot; show where it is now.
  const current = plan.sessionId ? byId.get(plan.sessionId) : undefined;
  const currentRow: RoomRow[] =
    current?.scheduledStartTime
      ? [
          {
            id: current.id,
            title: current.title,
            start: current.scheduledStartTime,
            durationMinutes: current.durationMinutes,
            moved: false,
          },
        ]
      : [];

  return {
    before: order([...plan.moves.map((m) => moved(m, "from")), ...currentRow]),
    after: order([...plan.moves.map((m) => moved(m, "to")), placed]),
  };
}
