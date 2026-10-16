import type {
  PlacementMove,
  PlacementPlan,
  PlacementPlanMove,
} from "@zenflow/shared";
import type { PlacementPlan as PlacementPlanRow } from "../../../generated/prisma";

/** A stored plan's moves as the client sees them (ISO instants). */
export function planMovesOf(moves: PlacementMove[]): PlacementPlanMove[] {
  return moves.map((m) => ({
    id: m.id,
    from: new Date(m.fromMs).toISOString(),
    to: new Date(m.toMs).toISOString(),
    anchor: m.anchor,
    cost: m.cost,
  }));
}

/** A `PlacementPlan` row as the wire `PlacementPlan`. */
export function toPlacementPlanDto(
  row: Pick<
    PlacementPlanRow,
    "id" | "subjectId" | "startAt" | "moves" | "expiresAt"
  >,
): PlacementPlan {
  return {
    id: row.id,
    sessionId: row.subjectId,
    start: row.startAt.toISOString(),
    moves: planMovesOf(row.moves as unknown as PlacementMove[]),
    expiresAt: row.expiresAt.toISOString(),
  };
}
