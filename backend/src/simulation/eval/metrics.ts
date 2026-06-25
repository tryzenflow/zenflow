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
  /**
   * STABLE per-persona key — the deterministic persona email
   * `sim-{archetype}-{index}-{seed}@zenflow.sim` (persona.factory.ts). Unlike
   * `userId` (a random UUID minted per run), this key is identical for the SAME
   * persona across the two A/B arms, so the paired significance tool can match
   * arms by it directly without an out-of-band re-key step. Empty string for any
   * user row without an email (should not happen for sim personas).
   */
  personaKey: string;
  scheduled: number; // tasks that received a suggested placement (CREATE w/ slot)
  adjusted: number; // tasks moved or resized after suggestion (MAR numerator)
  mar: number;
  /**
   * MAR decomposition (§5.6, §12): MOVEs caused by an urgency spike — not the
   * scheduler's fault. Only populated when the ground-truth sidecar is supplied
   * to `computeMetrics`; otherwise equals `mar` (conservative: treats all as
   * avoidable, which is the Phase-1 baseline behaviour).
   */
  marAvoidable: number;
  /**
   * MAR from urgency spikes / feasibility-forced moves — unavoidable regardless
   * of how good the scheduler is. Only populated with the sidecar; otherwise 0.
   */
  marUnavoidable: number;
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
    /** Mean avoidable MAR across personas (populated when sidecar is supplied). */
    marAvoidableMean: number;
    /** Mean unavoidable MAR across personas (populated when sidecar is supplied). */
    marUnavoidableMean: number;
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

/**
 * Compute per-persona + aggregate metrics from all logged events.
 *
 * @param urgencyByUser - Optional map of `userId → Set<taskId>` for tasks that
 *   were urgency-spike-moved. When supplied, MOVEs for tasks in the set count as
 *   `MAR_unavoidable` (not the scheduler's fault); all others are `MAR_avoidable`.
 *   Without it, `marAvoidable === mar` (conservative Phase-1 baseline).
 *   Build this from a loaded ground-truth sidecar (`PersonaGroundTruth.urgencyMovedTaskIds`).
 */
export async function computeMetrics(
  prisma: PrismaService,
  urgencyByUser?: Map<string, Set<string>>,
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

  // The deterministic persona email is the stable cross-arm pairing key (the
  // random `userId` differs between arms). Join it from the `User` rows.
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  const perPersona: PersonaMetrics[] = [];
  for (const [userId, evs] of byUser) {
    perPersona.push(
      personaMetrics(
        userId,
        emailById.get(userId) ?? "",
        evs,
        urgencyByUser?.get(userId),
      ),
    );
  }
  perPersona.sort((a, b) => a.userId.localeCompare(b.userId));

  const mars = perPersona.map((p) => p.mar);
  const aggregate = {
    personas: perPersona.length,
    marMean: mean(mars),
    marMedian: median(mars),
    marAvoidableMean: mean(perPersona.map((p) => p.marAvoidable)),
    marUnavoidableMean: mean(perPersona.map((p) => p.marUnavoidable)),
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
function personaMetrics(
  userId: string,
  personaKey: string,
  evs: EventRow[],
  urgencyMovedIds?: Set<string>,
): PersonaMetrics {
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
  let adjustedUnavoidable = 0;
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
      // If any MOVE for this task is urgency-driven, the whole adjustment is
      // unavoidable (the urgency spike was the primary cause).
      const taskId = list[0]?.taskId;
      if (taskId && urgencyMovedIds?.has(taskId)) {
        adjustedUnavoidable++;
      }
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
  // When the urgency sidecar is absent, treat all adjustments as avoidable
  // (conservative Phase-1 baseline: marAvoidable === mar, marUnavoidable === 0).
  const marUnavoidable =
    urgencyMovedIds !== undefined && scheduled > 0
      ? adjustedUnavoidable / scheduled
      : 0;
  const marAvoidable = mar - marUnavoidable;
  return {
    userId,
    personaKey,
    scheduled,
    adjusted,
    mar,
    marAvoidable,
    marUnavoidable,
    slotAcceptanceRate: 1 - mar,
    moveDistanceMedianMin: median(moveDistances),
    durationErrorMedianMin: median(durationErrors),
    completionInSlotRate: scheduled > 0 ? completedInSlot / scheduled : 0,
    timeToStable: mean(editCounts),
    abandonRate: scheduled > 0 ? abandoned / scheduled : 0,
    counts,
  };
}
