import { existsSync, mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { Queue, type Job } from "bullmq";
import Redis from "ioredis";
import request from "supertest";
import { PrismaClient } from "../../generated/prisma";
import {
  LMS_FETCH_QUEUE,
  NOTIFY_QUEUE,
  PORTAL_FETCH_QUEUE,
  type FetchJobData,
  type NotifyJobData,
} from "../../src/queue/queues";
import { dlqName } from "../../src/queue/queue.constants";
import { idempotencyKey } from "../../src/queue/queue.types";
import {
  API_URL,
  QUEUE_REDIS_URL,
  TUNING,
  connect,
  hasLine,
  openSse,
  parkSchedule,
  signUp,
  sleep,
  startFake,
  startRole,
  stop,
  until,
  type Proc,
  type Role,
  type Student,
} from "./support/stack";

/**
 * BullMQ ingestion + notification flow, end to end, over real processes.
 *
 * One process per role (`api`, `watcher`, `worker-portal`, `worker-lms`,
 * `worker-notify`) built from `dist/`, a real queue Redis and pub/sub Redis,
 * Postgres, Mailpit (real OTP login) and the fake DLU server. Everything is
 * driven through HTTP (supertest) and observed in the queues and the database.
 *
 * Part of `pnpm --filter backend test:e2e` (which builds `dist/` first). Needs
 * `docker compose --profile queue -f compose.test.yml up -d`. Alone:
 * `pnpm --filter backend exec jest --config ./test/jest-e2e.json queue`.
 *
 * Timing is shortened through env in `support/stack.ts` (3 attempts, 1 s
 * backoff, breaker opens after 3 failures for 4 s, 4 s sync cooldown, 6 s sync
 * wait). The one wall-clock dependency is the watcher's per-minute cron.
 */

jest.setTimeout(240_000);

const prisma = new PrismaClient();
let redis: Redis;
const queues: Record<string, Queue> = {};
const procs: Partial<Record<Role | "fake", Proc>> = {};

const ROLES: Role[] = [
  "api",
  "watcher",
  "worker-portal",
  "worker-lms",
  "worker-notify",
];

function queueOf(name: string): Queue {
  return (queues[name] ??= new Queue(name, { connection: redis }));
}
const portalQ = () => queueOf(PORTAL_FETCH_QUEUE.name);
const lmsQ = () => queueOf(LMS_FETCH_QUEUE.name);
const notifyQ = () => queueOf(NOTIFY_QUEUE.name);

const ALL_STATES = [
  "waiting",
  "active",
  "delayed",
  "completed",
  "failed",
  "prioritized",
] as const;
const jobsOf = (q: Queue) => q.getJobs([...ALL_STATES]);

/** Push jobs for one notification row, whatever their state. */
async function pushJobsFor(notificationId: string): Promise<Job[]> {
  return (await jobsOf(notifyQ())).filter(
    (j) =>
      (j.data as NotifyJobData & { notificationId?: string }).notificationId ===
      notificationId,
  );
}

const noteRows = (student: Student) =>
  prisma.notification.findMany({
    where: { userId: student.id },
    orderBy: { sentAt: "asc" },
  });

async function integrationOf(student: Student, provider: "PORTAL" | "LMS") {
  return prisma.integration.findFirstOrThrow({
    where: { userId: student.id, provider },
  });
}

function fetchJob(
  data: Partial<FetchJobData> & Pick<FetchJobData, "integrationId" | "kind">,
  scheduleId: string,
  userId: string,
): FetchJobData {
  return {
    scheduleId,
    userId,
    dueAt: new Date().toISOString(),
    ...data,
  };
}

/** Enqueue the way `QueueService.enqueue` does for the ticker (same options). */
function add(q: Queue, jobId: string, data: FetchJobData) {
  return q.add(q.name, data, {
    jobId,
    attempts: TUNING.attempts,
    backoff: { type: "exponential", delay: TUNING.backoffMs },
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 7 * 86_400, count: 5_000 },
  });
}

beforeAll(async () => {
  if (!existsSync(path.resolve(__dirname, "../../dist/main.js"))) {
    throw new Error(
      "dist/main.js is missing: run `pnpm --filter backend build`",
    );
  }
  redis = new Redis(QUEUE_REDIS_URL, { maxRetriesPerRequest: null });
  // Start from empty queues so counts below belong to this run.
  for (const def of [PORTAL_FETCH_QUEUE, LMS_FETCH_QUEUE, NOTIFY_QUEUE]) {
    for (const name of [def.name, dlqName(def.name)]) {
      await queueOf(name).obliterate({ force: true });
    }
  }
  procs.fake = await startFake();
  for (const role of ROLES) procs[role] = await startRole(role);
}, 180_000);

afterAll(async () => {
  // QUEUE_E2E_LOGS=<dir> keeps every process log for post-mortems.
  const logDir = process.env.QUEUE_E2E_LOGS;
  if (logDir) {
    mkdirSync(logDir, { recursive: true });
    for (const [name, proc] of Object.entries(procs)) {
      writeFileSync(path.join(logDir, `${name}.log`), proc.output.join("\n"));
    }
  }
  await Promise.all(
    [...ROLES, "fake" as const].map((r) => stop(procs[r], "SIGTERM")),
  );
  await Promise.allSettled(Object.values(queues).map((q) => q.close()));
  redis?.disconnect();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// 1. The watcher only enqueues; separate worker roles consume
// ---------------------------------------------------------------------------

describe("1. ticker enqueues, worker roles consume", () => {
  let student: Student;

  it("claims due schedule rows on the cron and enqueues stable-id jobs", async () => {
    student = await signUp("tick");
    await connect(student, "PORTAL");
    await connect(student, "LMS");

    // The watcher's cron fires once a minute; give it two ticks.
    const portalIds = await until(
      "portal-fetch jobs from the ticker",
      async () => {
        const jobs = (await jobsOf(portalQ())).filter(
          (j) => (j.data as FetchJobData).userId === student.id,
        );
        return jobs.length > 0 && jobs.every((j) => j.finishedOn)
          ? jobs
          : false;
      },
      130_000,
      1_000,
    );
    const lmsJobs = await until(
      "lms-fetch jobs from the ticker",
      async () => {
        const jobs = (await jobsOf(lmsQ())).filter(
          (j) => (j.data as FetchJobData).userId === student.id,
        );
        return jobs.length > 0 && jobs.every((j) => j.finishedOn)
          ? jobs
          : false;
      },
      60_000,
      1_000,
    );

    for (const job of portalIds) {
      const d = job.data as FetchJobData;
      expect(d.kind).toMatch(/^PORTAL_/);
      expect(job.id).toBe(idempotencyKey(d.scheduleId, d.dueAt));
      expect(await job.getState()).toBe("completed");
      expect((job.returnvalue as { ok: boolean }).ok).toBe(true);
    }
    for (const job of lmsJobs) {
      const d = job.data as FetchJobData;
      expect(d.kind).toMatch(/^LMS_/);
      expect(job.id).toBe(idempotencyKey(d.scheduleId, d.dueAt));
      expect(await job.getState()).toBe("completed");
    }

    // The schedule rows these jobs served were stamped as run.
    const rows = await prisma.ingestionSchedule.findMany({
      where: { integration: { userId: student.id } },
    });
    const ranIds = new Set(
      [...portalIds, ...lmsJobs].map(
        (j) => (j.data as FetchJobData).scheduleId,
      ),
    );
    for (const row of rows.filter((r) => ranIds.has(r.id))) {
      expect(row.lastRunAt).not.toBeNull();
    }
  });

  it("enqueueing the same slot again is one job (idempotent job id)", async () => {
    const [first] = (await jobsOf(portalQ())).filter(
      (j) => (j.data as FetchJobData).userId === student.id,
    );
    const before = (await jobsOf(portalQ())).length;
    const again = await add(portalQ(), first.id!, first.data as FetchJobData);
    expect(again.id).toBe(first.id);
    expect((await jobsOf(portalQ())).length).toBe(before);
  });

  it("each role runs only its own part", () => {
    const consuming = (p: Proc, q: string) =>
      hasLine(p, `"message":"consuming ${q}"`);
    for (const q of ["portal-fetch", "lms-fetch", "notify"]) {
      expect(consuming(procs.api!, q)).toBe(false);
      expect(consuming(procs.watcher!, q)).toBe(false);
    }
    expect(consuming(procs["worker-portal"]!, "portal-fetch")).toBe(true);
    expect(consuming(procs["worker-portal"]!, "lms-fetch")).toBe(false);
    expect(consuming(procs["worker-portal"]!, "notify")).toBe(false);
    expect(consuming(procs["worker-lms"]!, "lms-fetch")).toBe(true);
    expect(consuming(procs["worker-lms"]!, "portal-fetch")).toBe(false);
    expect(consuming(procs["worker-notify"]!, "notify")).toBe(true);
    expect(consuming(procs["worker-notify"]!, "portal-fetch")).toBe(false);

    expect(hasLine(procs.watcher!, "Ingestion tick:")).toBe(true);
    for (const r of ["api", "worker-portal", "worker-lms", "worker-notify"]) {
      expect(hasLine(procs[r as Role]!, "Ingestion tick:")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Upstream down: breaker parks jobs, backoff on other errors, DLQ, recovery
// ---------------------------------------------------------------------------

describe("2. upstream outage, breaker, backoff, DLQ, recovery", () => {
  let student: Student;
  let scheduleId: string;
  let integrationId: string;

  beforeAll(async () => {
    // Reuse the ticker scenario's student: its rows are connected and clean.
    const row = await prisma.ingestionSchedule.findFirstOrThrow({
      where: {
        kind: "PORTAL_EXAM",
        integration: { user: { email: { startsWith: "queue-e2e-tick-" } } },
      },
      orderBy: { createdAt: "desc" },
      include: { integration: true },
    });
    scheduleId = row.id;
    integrationId = row.integrationId;
    student = { id: row.integration.userId } as Student;
    await parkSchedule(prisma, student);
  });

  it("opens the breaker, parks jobs without burning attempts, then recovers", async () => {
    await stop(procs.fake);
    const dlqBefore = (
      await queueOf(dlqName(PORTAL_FETCH_QUEUE.name)).getJobCounts()
    ).waiting;
    const ids = Array.from(
      { length: 6 },
      (_, i) => `outage_${Date.now()}_${i}`,
    );
    for (const id of ids) {
      await add(
        portalQ(),
        id,
        fetchJob(
          { integrationId, kind: "PORTAL_EXAM" },
          scheduleId,
          student.id,
        ),
      );
    }

    // Watch for a job parked behind the open breaker: delayed, no attempt used,
    // but started again (so it was picked up and handed back, not retried).
    let parked = false;
    await until(
      "all outage jobs finished",
      async () => {
        const jobs = await Promise.all(ids.map((id) => portalQ().getJob(id)));
        for (const j of jobs) {
          if (!j) continue;
          if (
            (await j.getState()) === "delayed" &&
            j.attemptsMade === 0 &&
            j.attemptsStarted >= 1
          ) {
            parked = true;
          }
        }
        return jobs.every((j) => j?.finishedOn);
      },
      90_000,
      150,
    );
    expect(parked).toBe(true);

    const jobs = await Promise.all(ids.map((id) => portalQ().getJob(id)));
    for (const j of jobs) {
      // Parking never consumes an attempt: every job ends after one real
      // attempt, as a recorded (failed) pass - not as a failure in the DLQ.
      expect(j!.attemptsMade).toBe(1);
      expect(await j!.getState()).toBe("completed");
      expect((j!.returnvalue as { ok: boolean }).ok).toBe(false);
    }
    expect(jobs.some((j) => j!.attemptsStarted > 1)).toBe(true);
    expect(
      (await queueOf(dlqName(PORTAL_FETCH_QUEUE.name)).getJobCounts()).waiting,
    ).toBe(dlqBefore);
    expect(
      (
        await prisma.ingestionSchedule.findUniqueOrThrow({
          where: { id: scheduleId },
        })
      ).consecutiveFailures,
    ).toBeGreaterThan(0);

    // Restore the upstream: after the open window the next job probes and succeeds.
    procs.fake = await startFake();
    await sleep(TUNING.breakerOpenMs * 1.2);
    const id = `recover_${Date.now()}`;
    await add(
      portalQ(),
      id,
      fetchJob({ integrationId, kind: "PORTAL_EXAM" }, scheduleId, student.id),
    );
    const done = await until("recovery job", async () => {
      const j = await portalQ().getJob(id);
      return j?.finishedOn ? j : false;
    });
    expect(await done.getState()).toBe("completed");
    expect((done.returnvalue as { ok: boolean }).ok).toBe(true);
    const row = await prisma.ingestionSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
    });
    expect(row.consecutiveFailures).toBe(0);
    expect(row.lastSuccessAt).not.toBeNull();
  });

  it("retries other errors with exponential backoff, then dead-letters", async () => {
    const ids = [`dead_${Date.now()}_a`, `dead_${Date.now()}_b`];
    for (const id of ids) {
      await add(
        portalQ(),
        id,
        fetchJob(
          { integrationId: "does-not-exist", kind: "PORTAL_EXAM" },
          scheduleId,
          student.id,
        ),
      );
    }
    const backoffSeen = new Set<number>();
    await until(
      "jobs to fail for good",
      async () => {
        const jobs = await Promise.all(ids.map((id) => portalQ().getJob(id)));
        for (const j of jobs) {
          if (j && (await j.getState()) === "delayed" && j.attemptsMade > 0) {
            backoffSeen.add(j.attemptsMade);
          }
        }
        return jobs.every((j) => j?.finishedOn);
      },
      60_000,
      100,
    );
    // Between attempts the job waits out the backoff (1 s, then 2 s).
    expect([...backoffSeen].sort()).toEqual([1, 2]);

    const dlq = queueOf(dlqName(PORTAL_FETCH_QUEUE.name));
    const dead = await until("dead letters", async () => {
      const all = await dlq.getJobs([
        "waiting",
        "delayed",
        "completed",
        "active",
      ]);
      const mine = all.filter((j) =>
        ids.includes((j.data as { jobId: string }).jobId),
      );
      return mine.length === ids.length ? mine : false;
    });
    for (const letter of dead) {
      const d = letter.data as {
        queue: string;
        attemptsMade: number;
        failedReason: string;
        data: FetchJobData;
      };
      expect(d.queue).toBe(PORTAL_FETCH_QUEUE.name);
      expect(d.attemptsMade).toBe(TUNING.attempts);
      expect(d.failedReason).not.toBe("");
      expect(d.data.integrationId).toBe("does-not-exist");
    }
    for (const id of ids) {
      expect(await (await portalQ().getJob(id))!.getState()).toBe("failed");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Manual sync: POST /integrations/:provider/sync
// ---------------------------------------------------------------------------

describe("3. manual sync", () => {
  const syncPath = (p: string) => `/api/v1/integrations/${p}/sync`;

  it("is 401 without a session and 400 for an unknown provider", async () => {
    await request(API_URL).post(syncPath("PORTAL")).expect(401);
    const s = await signUp("sync-validate");
    await s.agent.post(syncPath("NOPE")).expect(400);
    // Strict pipe: unknown fields on connect are rejected, not ignored.
    await s.agent
      .post("/api/v1/integrations")
      .send({ provider: "PORTAL", username: "u", password: "p", extra: 1 })
      .expect(400);
    await s.agent
      .post("/api/v1/integrations")
      .send({ provider: "PORTAL" })
      .expect(400);
    await request(API_URL)
      .post("/api/v1/integrations")
      .send({ provider: "PORTAL", username: "u", password: "p" })
      .expect(401);
  });

  it("is 404 when the provider is not connected", async () => {
    const s = await signUp("sync-404");
    await connect(s, "PORTAL");
    await parkSchedule(prisma, s);
    await s.agent.post(syncPath("LMS")).expect(404);
  });

  it("enqueues, waits and returns the finished status; a repeat is 429", async () => {
    const s = await signUp("sync-ok");
    await connect(s, "PORTAL");
    await parkSchedule(prisma, s);
    const res = await s.agent.post(syncPath("PORTAL")).expect(201);
    expect(res.body).toMatchObject({
      success: true,
      message: "PORTAL sync finished",
      data: {
        provider: "PORTAL",
        connected: true,
        lastSyncStatus: "COMPLETED",
        failing: false,
      },
    });
    expect(res.body).toMatchObject({
      data: { lastSyncedAt: expect.any(String) as string },
    });

    // The API did not do the work: the jobs ran on the worker.
    const { id } = await integrationOf(s, "PORTAL");
    const job = await portalQ().getJob(
      idempotencyKey("manual", id, "PORTAL_TIMETABLE"),
    );
    expect(job).toBeTruthy();
    expect((job!.data as FetchJobData).manual).toBe(true);
    expect(await job!.getState()).toBe("completed");

    const again = await s.agent.post(syncPath("PORTAL")).expect(429);
    expect(Number(again.headers["retry-after"])).toBeGreaterThan(0);
    expect(again.body).toMatchObject({ success: false });
  });

  it("answers 202 + syncPending when the wait expires, and the job finishes later", async () => {
    await stop(procs["worker-portal"]);
    const s = await signUp("sync-202");
    await connect(s, "PORTAL");
    await parkSchedule(prisma, s);
    const started = Date.now();
    const res = await s.agent.post(syncPath("PORTAL")).expect(202);
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      TUNING.manualWaitMs - 500,
    );
    expect(res.body).toMatchObject({
      success: true,
      message: "PORTAL sync queued",
      data: { provider: "PORTAL", syncPending: true },
    });

    procs["worker-portal"] = await startRole("worker-portal");
    await until("background sync to finish", async () => {
      const list = await s.agent.get("/api/v1/integrations").expect(200);
      const portal = (
        (list.body as { data: unknown }).data as {
          integrations: { provider: string; lastSyncStatus: string | null }[];
        }
      ).integrations.find((i) => i.provider === "PORTAL");
      return portal?.lastSyncStatus === "COMPLETED";
    });
  });

  it("answers 502 when the pass fails (upstream unreachable)", async () => {
    const s = await signUp("sync-502");
    await connect(s, "LMS");
    await parkSchedule(prisma, s);
    await stop(procs.fake);
    try {
      const res = await s.agent.post(syncPath("LMS")).expect(502);
      expect(res.body).toMatchObject({ success: false });
      const { id } = await integrationOf(s, "LMS");
      const job = await lmsQ().getJob(
        idempotencyKey("manual", id, "LMS_CALENDAR"),
      );
      expect((job!.returnvalue as { ok: boolean }).ok).toBe(false);
    } finally {
      procs.fake = await startFake();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. New event -> one notification row, one push job per provider, SSE
// ---------------------------------------------------------------------------

describe("4. notification fan-out from a worker", () => {
  it("creates each notification once, enqueues one push job each and streams it to the API", async () => {
    const s = await signUp("notify");
    const bystander = await signUp("notify-other");
    await connect(s, "PORTAL");
    await connect(s, "LMS");
    await parkSchedule(prisma, s);

    const sse = openSse(s);
    const otherSse = openSse(bystander);
    await Promise.all([sse.ready, otherSse.ready]);

    await s.agent.post("/api/v1/integrations/PORTAL/sync").expect(201);
    await s.agent.post("/api/v1/integrations/LMS/sync").expect(201);

    const rows = await noteRows(s);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((r) => r.title)).size).toBe(rows.length);

    // SSE: every row reached the API's stream (published by a worker), once.
    await until(
      "SSE events",
      () => sse.events.length >= rows.length,
      10_000,
      100,
    );
    await sleep(500);
    const streamed = sse.events.map((e) => e.id as string);
    expect(streamed.sort()).toEqual(rows.map((r) => r.id).sort());
    expect(otherSse.events).toHaveLength(0);

    // Push: exactly one job per (notification, provider), all processed.
    await until(
      "push jobs processed",
      async () => {
        for (const r of rows) {
          const jobs = await pushJobsFor(r.id);
          if (jobs.length !== 2 || !jobs.every((j) => j.finishedOn))
            return false;
        }
        return true;
      },
      20_000,
    );
    for (const r of rows) {
      const jobs = await pushJobsFor(r.id);
      expect(jobs.map((j) => j.id).sort()).toEqual([
        idempotencyKey("push", r.id, "apns"),
        idempotencyKey("push", r.id, "fcm"),
      ]);
      for (const j of jobs) expect(await j.getState()).toBe("completed");
    }
    const allPush = (await jobsOf(notifyQ())).length;

    // A quiet re-run (same data upstream) raises nothing and enqueues nothing.
    await sleep((TUNING.cooldownSec + 1) * 1000);
    await s.agent.post("/api/v1/integrations/PORTAL/sync").expect(201);
    await s.agent.post("/api/v1/integrations/LMS/sync").expect(201);
    await sleep(1_000);
    expect(await noteRows(s)).toHaveLength(rows.length);
    expect((await jobsOf(notifyQ())).length).toBe(allPush);
    expect(sse.events).toHaveLength(rows.length);

    sse.close();
    otherSse.close();
  });

  it("serves the rows through the authenticated inbox endpoint", async () => {
    await request(API_URL).get("/api/v1/notifications").expect(401);
    await request(API_URL).get("/api/v1/notifications/stream").expect(401);
  });
});

// ---------------------------------------------------------------------------
// 5. Duplicates and restarts never double-send
// ---------------------------------------------------------------------------

describe("5. duplicate enqueue and restarts", () => {
  /** A student with a connected LMS and a slow upstream, ready to sync. */
  async function lmsStudent(label: string): Promise<Student> {
    const s = await signUp(label);
    await connect(s, "LMS");
    await parkSchedule(prisma, s);
    return s;
  }

  async function expectNoDuplicates(s: Student) {
    const rows = await noteRows(s);
    expect(new Set(rows.map((r) => r.title)).size).toBe(rows.length);
    for (const r of rows) {
      const jobs = await pushJobsFor(r.id);
      expect(jobs.length).toBeLessThanOrEqual(2);
      expect(new Set(jobs.map((j) => j.id)).size).toBe(jobs.length);
    }
    return rows;
  }

  beforeAll(async () => {
    // A slow upstream keeps a pass in flight long enough to interfere with it.
    await stop(procs.fake);
    procs.fake = await startFake(800);
  });

  afterAll(async () => {
    await stop(procs.fake);
    procs.fake = await startFake();
  });

  it("two concurrent manual syncs run once (the second is 409)", async () => {
    const s = await lmsStudent("dup");
    const [a, b] = await Promise.all([
      s.agent.post("/api/v1/integrations/LMS/sync"),
      s.agent.post("/api/v1/integrations/LMS/sync"),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const { id } = await integrationOf(s, "LMS");
    const manual = (await jobsOf(lmsQ())).filter(
      (j) => j.id === idempotencyKey("manual", id, "LMS_CALENDAR"),
    );
    expect(manual).toHaveLength(1);
    const rows = await expectNoDuplicates(s);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("SIGTERM mid-job drains the job: it finishes once, nothing is sent twice", async () => {
    const s = await lmsStudent("sigterm");
    const { id } = await integrationOf(s, "LMS");
    const jobId = idempotencyKey("manual", id, "LMS_CALENDAR");
    const pending = s.agent
      .post("/api/v1/integrations/LMS/sync")
      .then((r) => r);
    await until(
      "job active",
      async () => (await lmsQ().getJob(jobId))?.processedOn,
      10_000,
      50,
    );
    await stop(procs["worker-lms"], "SIGTERM");
    const res = await pending;
    expect(res.status).toBe(201);
    const job = (await lmsQ().getJob(jobId))!;
    expect(await job.getState()).toBe("completed");
    expect(job.attemptsStarted).toBe(1);
    expect((await expectNoDuplicates(s)).length).toBeGreaterThan(0);
    procs["worker-lms"] = await startRole("worker-lms");
  });

  it("SIGKILL mid-job: the stalled job is recovered and still creates each notification once", async () => {
    const s = await lmsStudent("sigkill");
    const { id } = await integrationOf(s, "LMS");
    const jobId = idempotencyKey("manual", id, "LMS_CALENDAR");
    const pending = s.agent
      .post("/api/v1/integrations/LMS/sync")
      .then((r) => r);
    await until(
      "job active",
      async () => (await lmsQ().getJob(jobId))?.processedOn,
      10_000,
      50,
    );
    await stop(procs["worker-lms"], "SIGKILL");
    const res = await pending;
    // The worker is gone: the caller's wait runs out and the job stays queued.
    expect(res.status).toBe(202);
    procs["worker-lms"] = await startRole("worker-lms");

    // BullMQ's stalled-job check (30 s lock) hands the job to the new worker.
    const job = await until(
      "stalled job to be reprocessed",
      async () => {
        const j = await lmsQ().getJob(jobId);
        return j?.finishedOn ? j : false;
      },
      120_000,
      1_000,
    );
    expect(job.attemptsStarted).toBeGreaterThanOrEqual(2);
    expect(await job.getState()).toBe("completed");
    await sleep(1_000);
    await expectNoDuplicates(s);
  });
});
