import type { PrismaService } from "../../prisma/prisma.service";
import { computeMetrics } from "./metrics";

/**
 * MAR + supporting metrics must match hand-computed fixtures. The event log is
 * the only input (no latent params), so we feed `computeMetrics` a small,
 * fully-known TaskEvent stream via a Prisma mock and assert each metric.
 */

interface Ev {
  taskId: string;
  userId: string;
  eventType: string;
  oldSnapshot: unknown;
  newSnapshot: unknown;
  occurredAt: Date;
}

function snap(scheduledStartTime: string | null, durationMinutes: number) {
  return { scheduledStartTime, durationMinutes, tags: [] };
}

/**
 * Build a Prisma mock whose `taskEvent.findMany` returns `events` and whose
 * `user.findMany` returns the `users` (id + email) the metrics join for the
 * stable per-persona key. Unknown users fall back to an empty key.
 */
function mockPrisma(
  events: Ev[],
  users: { id: string; email: string }[] = [],
): PrismaService {
  return {
    taskEvent: {
      findMany: jest.fn().mockResolvedValue(events),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(users),
    },
  } as unknown as PrismaService;
}

const T0 = "2025-01-06T09:00:00.000Z";
const T1 = "2025-01-06T11:00:00.000Z"; // +120 min from T0

describe("computeMetrics", () => {
  it("computes MAR, acceptance, move distance, duration error, completion-in-slot", async () => {
    // User u1, three scheduled tasks:
    //  - taskA: created placed, then MOVED to T1 (adjusted; move-distance 120m).
    //  - taskB: created placed, KEEP+COMPLETE untouched (accepted, in-slot).
    //  - taskC: created placed, RESIZED 60→120 (adjusted; dur-error 60m), completed.
    const events: Ev[] = [
      {
        taskId: "A",
        userId: "u1",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
      {
        taskId: "A",
        userId: "u1",
        eventType: "MOVE",
        oldSnapshot: { ...snap(T0, 60), suggestedStartTime: T0 },
        newSnapshot: { ...snap(T1, 60), suggestedStartTime: T0 },
        occurredAt: new Date(T1),
      },
      {
        taskId: "B",
        userId: "u1",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
      {
        taskId: "B",
        userId: "u1",
        eventType: "KEEP",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T1),
      },
      {
        taskId: "B",
        userId: "u1",
        eventType: "COMPLETE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T1),
      },
      {
        taskId: "C",
        userId: "u1",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
      {
        taskId: "C",
        userId: "u1",
        eventType: "RESIZE",
        oldSnapshot: { ...snap(T0, 60), suggestedStartTime: T0 },
        newSnapshot: { ...snap(T0, 120), suggestedStartTime: T0 },
        occurredAt: new Date(T1),
      },
      {
        taskId: "C",
        userId: "u1",
        eventType: "COMPLETE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 120),
        occurredAt: new Date(T1),
      },
    ];

    const report = await computeMetrics(
      mockPrisma(events, [{ id: "u1", email: "sim-dev-0-1@zenflow.sim" }]),
    );
    expect(report.perPersona).toHaveLength(1);
    const m = report.perPersona[0];

    // Stable per-persona key joined from the User row (the deterministic email).
    expect(m.personaKey).toBe("sim-dev-0-1@zenflow.sim");

    // 3 scheduled, 2 adjusted (A moved, C resized) → MAR = 2/3.
    expect(m.scheduled).toBe(3);
    expect(m.adjusted).toBe(2);
    expect(m.mar).toBeCloseTo(2 / 3, 6);
    expect(m.slotAcceptanceRate).toBeCloseTo(1 / 3, 6);

    // Move distance: only A moved (T0→T1 = 120 min). C's resize kept the slot
    // (T0→T0 = 0). Median of [120, 0] = 60.
    expect(m.moveDistanceMedianMin).toBe(60);

    // Duration error: C resized 60→120 → 60. Median = 60.
    expect(m.durationErrorMedianMin).toBe(60);

    // Completion-in-slot: only B completed untouched → 1/3.
    expect(m.completionInSlotRate).toBeCloseTo(1 / 3, 6);

    // Time-to-stable: A had 1 edit, C had 1 edit → mean 1.
    expect(m.timeToStable).toBe(1);
  });

  it("handles a fully-accepted persona (MAR 0)", async () => {
    const events: Ev[] = [
      {
        taskId: "X",
        userId: "u2",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 30),
        occurredAt: new Date(T0),
      },
      {
        taskId: "X",
        userId: "u2",
        eventType: "COMPLETE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 30),
        occurredAt: new Date(T1),
      },
    ];
    const report = await computeMetrics(mockPrisma(events));
    const m = report.perPersona[0];
    // No user row supplied → key falls back to an empty string (never throws).
    expect(m.personaKey).toBe("");
    expect(m.mar).toBe(0);
    expect(m.completionInSlotRate).toBe(1);
    expect(m.moveDistanceMedianMin).toBe(0);
  });

  it("without sidecar, marAvoidable === mar and marUnavoidable === 0", async () => {
    const events: Ev[] = [
      {
        taskId: "A",
        userId: "u1",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
      {
        taskId: "A",
        userId: "u1",
        eventType: "MOVE",
        oldSnapshot: snap(T0, 60),
        newSnapshot: snap(T1, 60),
        occurredAt: new Date(T1),
      },
    ];
    // No urgencyByUser supplied → conservative baseline.
    const report = await computeMetrics(mockPrisma(events));
    const m = report.perPersona[0];
    expect(m.marUnavoidable).toBe(0);
    expect(m.marAvoidable).toBeCloseTo(m.mar, 10);
  });

  it("with sidecar, urgency-moved tasks count as marUnavoidable", async () => {
    const events: Ev[] = [
      // taskA was moved (urgency spike → unavoidable).
      {
        taskId: "A",
        userId: "u1",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
      {
        taskId: "A",
        userId: "u1",
        eventType: "MOVE",
        oldSnapshot: snap(T0, 60),
        newSnapshot: snap(T1, 60),
        occurredAt: new Date(T1),
      },
      // taskB was moved (preference-based → avoidable).
      {
        taskId: "B",
        userId: "u1",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
      {
        taskId: "B",
        userId: "u1",
        eventType: "MOVE",
        oldSnapshot: snap(T0, 60),
        newSnapshot: snap(T1, 60),
        occurredAt: new Date(T1),
      },
      // taskC: kept (no move, not adjusted).
      {
        taskId: "C",
        userId: "u1",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
    ];
    const urgencyByUser = new Map([["u1", new Set(["A"])]]);
    const report = await computeMetrics(mockPrisma(events), urgencyByUser);
    const m = report.perPersona[0];
    // 3 scheduled, 2 adjusted (A + B moved).
    expect(m.scheduled).toBe(3);
    expect(m.adjusted).toBe(2);
    expect(m.mar).toBeCloseTo(2 / 3, 6);
    // A is urgency-moved → 1 unavoidable; B is avoidable → 1 avoidable.
    expect(m.marUnavoidable).toBeCloseTo(1 / 3, 6);
    expect(m.marAvoidable).toBeCloseTo(1 / 3, 6);
  });

  it("aggregates per persona (unit of analysis = persona)", async () => {
    const events: Ev[] = [
      // u1: 1 scheduled, moved → MAR 1.
      {
        taskId: "A",
        userId: "u1",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
      {
        taskId: "A",
        userId: "u1",
        eventType: "MOVE",
        oldSnapshot: { ...snap(T0, 60), suggestedStartTime: T0 },
        newSnapshot: { ...snap(T1, 60), suggestedStartTime: T0 },
        occurredAt: new Date(T1),
      },
      // u2: 1 scheduled, kept → MAR 0.
      {
        taskId: "B",
        userId: "u2",
        eventType: "CREATE",
        oldSnapshot: null,
        newSnapshot: snap(T0, 60),
        occurredAt: new Date(T0),
      },
    ];
    const report = await computeMetrics(mockPrisma(events));
    expect(report.aggregate.personas).toBe(2);
    // Mean of [1, 0] = 0.5.
    expect(report.aggregate.marMean).toBeCloseTo(0.5, 6);
  });
});
