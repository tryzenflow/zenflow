import type { PlacementReason } from "@zenflow/shared";

/**
 * The `Session` columns a placed start is written with: the start, and the
 * reason for it (#254) stamped with that same start, so a later move leaves
 * the reason stale and the API hides it.
 */
export function placementData(p: {
  scheduledStartTime: Date | null;
  placementReason?: PlacementReason | null;
}): {
  scheduledStartTime: Date | null;
  placementReason: PlacementReason | null;
  placementReasonStartAt: Date | null;
} {
  const reason = p.scheduledStartTime ? (p.placementReason ?? null) : null;
  return {
    scheduledStartTime: p.scheduledStartTime,
    placementReason: reason,
    placementReasonStartAt: reason ? p.scheduledStartTime : null,
  };
}
