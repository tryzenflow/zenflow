import type { PrismaService } from "../../prisma/prisma.service";
import type { TaskEventType } from "../../../generated/prisma";

/**
 * Evaluation metrics computed from the `TaskEvent` log (strategy §12, definitions
 * in `docs/heuristic.md` §Evaluation). Reads the production telemetry that the
 * closed-loop simulator produced — never the latent persona parameters — so the
 * numbers reflect what a learner could actually see.
 *
 * The metrics partition the north-star question cleanly:
 *  - MAR     = "did we miss?"        (per-task, binary)
 *  - Time-to-stable = "how much fiddling did the miss cost?" (edits per task)
 *  - Move distance  = "how far off were we?"  (minutes, suggested → final)
 */

/** Minimal event shape the metrics consume. */
interface EventRow {
  taskId: string;
  userId: string;
  eventType: TaskEventType;
  oldSnapshot: unknown;
  newSnapshot: unknown;
  occurredAt: Date;
}

interface Snapshot {
  scheduledStartTime: string | null;
  durationMinutes: number;
  tags?: string[];
  suggestedStartTime?: string | null;
}

function asSnapshot(v: unknown): Snapshot | null {
  if (!v || typeof v !== "object") return null;
  return v as Snapshot;
}

export interface PersonaMetrics {
  userId: string;
  scheduled: number; // tasks that received a suggested placement (CREATE w/ slot)
  adjusted: number; // tasks moved or resized after suggestion (MAR numerator)
  mar: number;
  slotAcceptanceRate: number; // 1 - MAR
  /** Median minutes between suggested and final chosen slot (adjusted tasks). */
  moveDistanceMedianMin: number;
  /** Median |actual − suggested duration| over RESIZE events. */
  durationErrorMedianMin: number;
  /** Tasks completed in their suggested slot ÷ scheduled. */
  completionInSlotRate: number;
  /** Mean count of edits (MOVE+RESIZE) per touched task. */
  timeToStable: number;
  abandonRate: number;
  counts: Record<string, number>;
}

export interface MetricsReport {
  perPersona: PersonaMetrics[];
  /** Population aggregate (unit of analysis = persona, strategy §13 Step 3). */
  aggregate: {
    personas: number;
    marMean: number;
    marMedian: number;
    completionInSlotMean: number;
    moveDistanceMedianMin: number;
    durationErrorMedianMin: number;
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Compute per-persona + aggregate metrics from all logged events. */
export async function computeMetrics(
  prisma: PrismaService,
): Promise<MetricsReport> {
  const events = (await prisma.taskEvent.findMany({
    orderBy: { occurredAt: "asc" },
    select: {
      taskId: true,
      userId: true,
      eventType: true,
      oldSnapshot: true,
      newSnapshot: true,
      occurredAt: true,
    },
  })) as unknown as EventRow[];

  const byUser = new Map<string, EventRow[]>();
  for (const e of events) {
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }

  const perPersona: PersonaMetrics[] = [];
  for (const [userId, evs] of byUser) {
    perPersona.push(personaMetrics(userId, evs));
  }
  perPersona.sort((a, b) => a.userId.localeCompare(b.userId));

  const mars = perPersona.map((p) => p.mar);
  const aggregate = {
    personas: perPersona.length,
    marMean: mean(mars),
    marMedian: median(mars),
    completionInSlotMean: mean(perPersona.map((p) => p.completionInSlotRate)),
    moveDistanceMedianMin: median(
      perPersona.map((p) => p.moveDistanceMedianMin),
    ),
    durationErrorMedianMin: median(
      perPersona.map((p) => p.durationErrorMedianMin),
    ),
  };

  return { perPersona, aggregate };
}

/** Per-task event grouping → the §12 metrics for one persona. */
function personaMetrics(userId: string, evs: EventRow[]): PersonaMetrics {
  const counts: Record<string, number> = {};
  for (const e of evs) counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;

  // Group events per task, in occurrence order.
  const byTask = new Map<string, EventRow[]>();
  for (const e of evs) {
    const list = byTask.get(e.taskId) ?? [];
    list.push(e);
    byTask.set(e.taskId, list);
  }

  let scheduled = 0;
  let adjusted = 0;
  let completedInSlot = 0;
  let abandoned = 0;
  const moveDistances: number[] = [];
  const durationErrors: number[] = [];
  const editCounts: number[] = [];

  for (const [, list] of byTask) {
    const create = list.find((e) => e.eventType === "CREATE");
    const createSnap = create ? asSnapshot(create.newSnapshot) : null;
    const wasScheduled = !!createSnap && createSnap.scheduledStartTime !== null;
    if (wasScheduled) scheduled++;

    const edits = list.filter(
      (e) => e.eventType === "MOVE" || e.eventType === "RESIZE",
    );
    if (wasScheduled && edits.length > 0) {
      adjusted++; // MAR is per-task binary
      editCounts.push(edits.length);
    }

    // Move distance: suggested (CREATE slot) → FINAL chosen slot.
    if (wasScheduled && edits.length > 0) {
      const suggested = createSnap.scheduledStartTime;
      const last = edits[edits.length - 1];
      const finalSnap = asSnapshot(last.newSnapshot);
      const finalSlot = finalSnap?.scheduledStartTime ?? null;
      if (suggested && finalSlot) {
        const d =
          Math.abs(
            new Date(finalSlot).getTime() - new Date(suggested).getTime(),
          ) / 60_000;
        moveDistances.push(d);
      }
    }

    // Duration error: |actual − suggested duration| over RESIZE events. The
    // resize's newSnapshot duration is the persona's true duration; the
    // suggested duration is the pre-edit (CREATE) duration.
    const resize = list.filter((e) => e.eventType === "RESIZE");
    if (resize.length > 0 && createSnap) {
      const last = asSnapshot(resize[resize.length - 1].newSnapshot);
      if (last) {
        durationErrors.push(
          Math.abs(last.durationMinutes - createSnap.durationMinutes),
        );
      }
    }

    // Completion-in-slot: completed AND never moved/resized after suggestion.
    const completed = list.some(
      (e) => e.eventType === "COMPLETE" || e.eventType === "KEEP",
    );
    if (wasScheduled && completed && edits.length === 0) completedInSlot++;

    if (list.some((e) => e.eventType === "ABANDON")) abandoned++;
  }

  const mar = scheduled > 0 ? adjusted / scheduled : 0;
  return {
    userId,
    scheduled,
    adjusted,
    mar,
    slotAcceptanceRate: 1 - mar,
    moveDistanceMedianMin: median(moveDistances),
    durationErrorMedianMin: median(durationErrors),
    completionInSlotRate: scheduled > 0 ? completedInSlot / scheduled : 0,
    timeToStable: mean(editCounts),
    abandonRate: scheduled > 0 ? abandoned / scheduled : 0,
    counts,
  };
}
