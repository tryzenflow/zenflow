import { DisplacedTask } from "@zenflow/shared";

export function toDisplaced(
  placements: { id: string; scheduledStartTime: Date | null }[],
): DisplacedTask[] {
  return placements.map((p) => ({
    taskId: p.id,
    newScheduledStartTime: p.scheduledStartTime
      ? p.scheduledStartTime.toISOString()
      : null,
  }));
}
