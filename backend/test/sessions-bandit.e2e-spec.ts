import type { CreateSessionResponse, Session } from "@zenflow/shared";
import { PrismaClient } from "../generated/prisma";
import { connectDb } from "./queue/support/db";
import {
  removeStudents,
  signUp,
  startRole,
  stop,
  type Proc,
  type Student,
} from "./queue/support/stack";

/**
 * Placement through the Python bandit service (the primary path), as opposed to
 * the frozen TS fallback that `sessions.e2e-spec.ts` runs on. Needs the service:
 * `docker compose --profile bandit -f compose.test.yml up -d` (port 8100), or
 * `BANDIT_E2E_URL` pointing at one. The suite fails without it rather than
 * skipping: Jest can't report a skip decided at run time, so a silent early
 * return would show as passed.
 */
jest.setTimeout(180_000);

const BANDIT_URL = process.env.BANDIT_E2E_URL ?? "http://127.0.0.1:8100";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SLOT = 15 * 60_000;
const SESSIONS = "/api/v1/sessions";

type SessionDto = CreateSessionResponse;

let api: Proc | undefined;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = connectDb();
  const up = await fetch(`${BANDIT_URL}/ready`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!up) {
    throw new Error(
      `bandit service not ready at ${BANDIT_URL}: start it with \`docker compose --profile bandit -f compose.test.yml up -d --build\``,
    );
  }
  api = await startRole("api", { BANDIT_SERVICE_URL: BANDIT_URL });
});
afterAll(async () => {
  await stop(api);
  await removeStudents(prisma);
  await prisma.$disconnect();
});

const iso = (ms: number) => new Date(ms).toISOString();
const startOf = (s: Pick<Session, "scheduledStartTime">) =>
  Date.parse(s.scheduledStartTime as string);
const endOf = (s: Pick<Session, "scheduledStartTime" | "durationMinutes">) =>
  startOf(s) + s.durationMinutes * 60_000;
const data = (res: { body: unknown }) =>
  (res.body as { data: SessionDto }).data;
const create = (student: Student, body: Record<string, unknown>) =>
  student.agent.post(SESSIONS).send(body);
const task = (over: Record<string, unknown> = {}) => ({
  type: "TASK",
  title: "Revise graphs",
  durationMinutes: 60,
  deadline: iso(Date.now() + 3 * DAY),
  ...over,
});

describe("with the bandit service", () => {
  it("places a task on the grid before its deadline, not degraded", async () => {
    const student = await signUp("bandit-place");
    const deadline = Date.now() + 3 * DAY;
    const placed = data(
      await create(student, task({ deadline: iso(deadline) })).expect(201),
    );
    expect(startOf(placed) % SLOT).toBe(0);
    expect(endOf(placed)).toBeLessThanOrEqual(deadline);
    expect(placed.schedulingDegraded).toBeFalsy();
    expect(placed.slotProposalId).toBeTruthy();
  });

  it("keeps two tasks apart", async () => {
    const student = await signUp("bandit-two");
    const a = data(await create(student, task({ title: "A" })).expect(201));
    const b = data(await create(student, task({ title: "B" })).expect(201));
    expect(startOf(a) < endOf(b) && startOf(b) < endOf(a)).toBe(false);
  });

  it("spreads a series over distinct days", async () => {
    const student = await signUp("bandit-series");
    const created = data(
      await create(
        student,
        task({ sessionCount: 3, deadline: iso(Date.now() + 6 * DAY) }),
      ).expect(201),
    );
    const sittings = created.sessions ?? [];
    expect(sittings).toHaveLength(3);
    expect(
      new Set(sittings.map((s) => iso(startOf(s)).slice(0, 10))).size,
    ).toBe(3);
    // The flag is on the response, not on each sitting.
    expect(created.schedulingDegraded).toBeFalsy();
  });

  describe("when the deadline cannot be met", () => {
    async function wall(student: Student) {
      // A fixed class covering the whole window: it never moves, so nothing is conflict-free.
      await create(student, {
        type: "LECTURE",
        title: "All day",
        durationMinutes: 12 * 60,
        scheduledStartTime: iso(Math.floor(Date.now() / SLOT) * SLOT),
      }).expect(201);
    }
    const tight = () => task({ deadline: iso(Date.now() + 3 * HOUR) });

    it("answers 409 SCHEDULE_INFEASIBLE", async () => {
      const student = await signUp("bandit-infeasible");
      await wall(student);
      const res = await create(student, tight()).expect(409);
      expect(res.body).toMatchObject({
        code: "SCHEDULE_INFEASIBLE",
        options: ["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"],
      });
    });

    it("ACCEPT_CONFLICTS meets the deadline by overlapping", async () => {
      const student = await signUp("bandit-conflicts");
      await wall(student);
      const deadline = Date.now() + 3 * HOUR;
      const placed = data(
        await create(student, {
          ...task({ deadline: iso(deadline) }),
          infeasiblePolicy: "ACCEPT_CONFLICTS",
        }).expect(201),
      );
      expect(endOf(placed)).toBeLessThanOrEqual(deadline);
      expect(placed.late).toBe(false);
    });

    it("ACCEPT_LATE_DEADLINE goes clear of the class, after the deadline", async () => {
      const student = await signUp("bandit-late");
      await wall(student);
      const deadline = Date.now() + 3 * HOUR;
      const placed = data(
        await create(student, {
          ...task({ deadline: iso(deadline) }),
          infeasiblePolicy: "ACCEPT_LATE_DEADLINE",
        }).expect(201),
      );
      expect(endOf(placed)).toBeGreaterThan(deadline);
      expect(placed.late).toBe(true);
    });
  });
});

describe("when the bandit service is unreachable", () => {
  it("still places the task, on the fallback, and says so", async () => {
    await stop(api);
    api = await startRole("api", { BANDIT_SERVICE_URL: "http://127.0.0.1:9" });
    const student = await signUp("bandit-down");
    const deadline = Date.now() + 3 * DAY;
    const placed = data(
      await create(student, task({ deadline: iso(deadline) })).expect(201),
    );
    expect(placed.schedulingDegraded).toBe(true);
    expect(startOf(placed) % SLOT).toBe(0);
    expect(endOf(placed)).toBeLessThanOrEqual(deadline);
  });
});
