import type {
  ConfirmPlacementResponse,
  CreateSessionResponse,
  PlacementNeedsConfirmationError,
  Session,
  UndoPlacementResponse,
} from "@zenflow/shared";
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
 * Anchors and the confirm flow (ADR-0022) through the Python bandit service.
 * Needs the service: `docker compose --profile bandit -f compose.test.yml up -d`
 * (port 8100), or `BANDIT_E2E_URL`. Fails without it rather than skipping.
 *
 * Every case builds the same calendar: fixed lectures leave one 1 h gap
 * [base + 2h, base + 3h) before the blocker's deadline (base + 3h), so the only
 * way in is to move whatever sits in the gap.
 */
jest.setTimeout(180_000);

const BANDIT_URL = process.env.BANDIT_E2E_URL ?? "http://127.0.0.1:8100";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SLOT = 15 * 60_000;
const SESSIONS = "/api/v1/sessions";

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
const data = <T = Session>(res: { body: unknown }) =>
  (res.body as { data: T }).data;
const body = (res: { body: unknown }) => res.body as Record<string, unknown>;
const needsConfirmation = (res: { body: unknown }) =>
  res.body as PlacementNeedsConfirmationError;

interface Calendar {
  base: number;
  gapStart: number;
  /** Start of the free time after the lectures. */
  farStart: number;
}

/**
 * Fixed lectures over [now, base) and [base + 3h, base + 8h), leaving the gap.
 * Free time resumes at base + 8h, so a moved session has somewhere to go.
 */
async function wall(student: Student): Promise<Calendar> {
  const now = Math.ceil(Date.now() / SLOT) * SLOT;
  const base = now + 3 * HOUR;
  const lecture = (start: number, minutes: number) =>
    student.agent
      .post(SESSIONS)
      .send({
        type: "LECTURE",
        title: "Class",
        durationMinutes: minutes,
        scheduledStartTime: iso(start),
      })
      .expect(201);
  await lecture(now, (base - now) / 60_000);
  await lecture(base, 120);
  await lecture(base + 3 * HOUR, 300);
  return { base, gapStart: base + 2 * HOUR, farStart: base + 8 * HOUR };
}

const task = (title: string, deadline: number) => ({
  type: "TASK",
  title,
  durationMinutes: 60,
  deadline: iso(deadline),
});

/** Create a task, then drag it to `to`: it ends up `CHOSEN` there. */
async function chosenAt(
  student: Student,
  title: string,
  cal: Calendar,
  to: number,
): Promise<CreateSessionResponse> {
  const created = data<CreateSessionResponse>(
    await student.agent
      .post(SESSIONS)
      .send(task(title, cal.base + 3 * DAY))
      .expect(201),
  );
  // Two drags, so the second always changes the start.
  await student.agent
    .patch(`${SESSIONS}/${created.id}`)
    .send({ scheduledStartTime: iso(cal.farStart + HOUR) })
    .expect(200);
  return data<CreateSessionResponse>(
    await student.agent
      .patch(`${SESSIONS}/${created.id}`)
      .send({ scheduledStartTime: iso(to) })
      .expect(200),
  );
}

const get = (student: Student, id: string) =>
  student.agent.get(`${SESSIONS}/${id}`);

describe("a chosen session", () => {
  it("a drag sets the anchor to CHOSEN", async () => {
    const student = await signUp("anchor-drag");
    const cal = await wall(student);
    const moved = await chosenAt(student, "Dragged", cal, cal.gapStart);
    expect(moved.anchor).toBe("CHOSEN");
    expect(moved.anchoredAt).toEqual(expect.any(String));
    expect(startOf(moved)).toBe(cal.gapStart);
  });

  it("is never moved without confirmation: the new task asks for a plan", async () => {
    const student = await signUp("anchor-ask");
    const cal = await wall(student);
    const chosen = await chosenAt(student, "Chosen", cal, cal.gapStart);

    const res = await student.agent
      .post(SESSIONS)
      .send(task("Blocker", cal.base + 3 * HOUR))
      .expect(409);
    const err = needsConfirmation(res);
    expect(err.code).toBe("NEEDS_CONFIRMATION");
    expect(err.data.plan.sessionId).toBeNull();
    expect(err.data.plan.moves.map((m) => m.id)).toContain(chosen.id);
    expect(err.data.plan.moves.find((m) => m.id === chosen.id)?.anchor).toBe(
      "CHOSEN",
    );

    // Nothing applied: the chosen session stays where the user put it, and
    // the new task was not kept.
    expect(startOf(data(await get(student, chosen.id).expect(200)))).toBe(
      cal.gapStart,
    );
    const kept = await prisma.session.count({
      where: { userId: student.id, title: "Blocker", deleted: false },
    });
    expect(kept).toBe(0);
  });

  it("confirm applies the plan atomically, and undo restores every moved session", async () => {
    const student = await signUp("anchor-confirm");
    const cal = await wall(student);
    const chosen = await chosenAt(student, "Chosen", cal, cal.gapStart);
    const err = needsConfirmation(
      await student.agent
        .post(SESSIONS)
        .send(task("Blocker", cal.base + 3 * HOUR))
        .expect(409),
    );
    const moveTo = err.data.plan.moves.find((m) => m.id === chosen.id)?.to;
    expect(moveTo).toBeDefined();

    const confirmed = data<ConfirmPlacementResponse>(
      await student.agent
        .post(`${SESSIONS}/placement/confirm`)
        .send({ planId: err.data.plan.id })
        .expect(201),
    );
    expect(confirmed.session.title).toBe("Blocker");
    expect(startOf(confirmed.session)).toBe(cal.gapStart);
    expect(confirmed.displacedSessions.map((d) => d.id)).toContain(chosen.id);
    expect(startOf(data(await get(student, chosen.id).expect(200)))).toBe(
      Date.parse(moveTo as string),
    );

    // Single use: the same plan cannot be applied twice.
    await student.agent
      .post(`${SESSIONS}/placement/confirm`)
      .send({ planId: err.data.plan.id })
      .expect(404);

    const undone = data<UndoPlacementResponse>(
      await student.agent
        .post(`${SESSIONS}/undo/${confirmed.undoGroupId}`)
        .expect(201),
    );
    expect(undone.restored.map((r) => r.id)).toContain(chosen.id);
    expect(undone.removedSessionIds).toContain(confirmed.session.id);
    expect(startOf(data(await get(student, chosen.id).expect(200)))).toBe(
      cal.gapStart,
    );
    await get(student, confirmed.session.id).expect(404);
  });

  it("a plan goes stale when a session it moves changes, and nothing is applied", async () => {
    const student = await signUp("anchor-stale");
    const cal = await wall(student);
    const chosen = await chosenAt(student, "Chosen", cal, cal.gapStart);
    const err = needsConfirmation(
      await student.agent
        .post(SESSIONS)
        .send(task("Blocker", cal.base + 3 * HOUR))
        .expect(409),
    );

    const elsewhere = cal.farStart + 2 * HOUR;
    await student.agent
      .patch(`${SESSIONS}/${chosen.id}`)
      .send({ scheduledStartTime: iso(elsewhere) })
      .expect(200);
    const stale = await student.agent
      .post(`${SESSIONS}/placement/confirm`)
      .send({ planId: err.data.plan.id })
      .expect(409);
    expect(body(stale)).toMatchObject({ code: "PLACEMENT_STALE" });
    expect(startOf(data(await get(student, chosen.id).expect(200)))).toBe(
      elsewhere,
    );
  });
});

describe("a pinned session", () => {
  it("never moves: with only a pinned session in the way, the task is infeasible", async () => {
    const student = await signUp("anchor-pin");
    const cal = await wall(student);
    const pinned = await chosenAt(student, "Pinned", cal, cal.gapStart);
    await student.agent.post(`${SESSIONS}/${pinned.id}/pin`).expect(201);

    const res = await student.agent
      .post(SESSIONS)
      .send(task("Blocker", cal.base + 3 * HOUR))
      .expect(409);
    expect(body(res)).toMatchObject({ code: "SCHEDULE_INFEASIBLE" });
    expect(startOf(data(await get(student, pinned.id).expect(200)))).toBe(
      cal.gapStart,
    );
  });

  it("unpin returns the task to AUTO", async () => {
    const student = await signUp("anchor-unpin");
    const cal = await wall(student);
    const pinned = await chosenAt(student, "Pinned", cal, cal.gapStart);
    await student.agent.post(`${SESSIONS}/${pinned.id}/pin`).expect(201);
    const unpinned = data<Session>(
      await student.agent.delete(`${SESSIONS}/${pinned.id}/pin`).expect(200),
    );
    expect(unpinned.anchor).toBe("AUTO");
    expect(unpinned.anchoredAt).toBeNull();
  });
});

describe("an automatic session", () => {
  it("is displaced without asking, and undo restores it and removes the new task", async () => {
    const student = await signUp("anchor-auto");
    const cal = await wall(student);
    // A temporary lecture covers the free time after the lectures while the
    // auto task is placed, so its only slot is the gap. It goes once placed.
    const temp = data<Session>(
      await student.agent
        .post(SESSIONS)
        .send({
          type: "LECTURE",
          title: "Temporary",
          durationMinutes: 4 * 60,
          scheduledStartTime: iso(cal.farStart),
        })
        .expect(201),
    );
    const auto = data<CreateSessionResponse>(
      await student.agent
        .post(SESSIONS)
        .send(task("Auto", cal.farStart + 4 * HOUR))
        .expect(201),
    );
    expect(auto.anchor).toBe("AUTO");
    expect(startOf(auto)).toBe(cal.gapStart);
    await student.agent.delete(`${SESSIONS}/${temp.id}`).expect(200);

    const created = data<CreateSessionResponse>(
      await student.agent
        .post(SESSIONS)
        .send(task("Blocker", cal.base + 3 * HOUR))
        .expect(201),
    );
    expect(startOf(created)).toBe(cal.gapStart);
    expect(created.displacedSessions.map((d) => d.id)).toContain(auto.id);
    expect(created.undoGroupId).toEqual(expect.any(String));
    expect(startOf(data(await get(student, auto.id).expect(200)))).not.toBe(
      cal.gapStart,
    );

    const undone = data<UndoPlacementResponse>(
      await student.agent
        .post(`${SESSIONS}/undo/${created.undoGroupId}`)
        .expect(201),
    );
    expect(undone.restored.map((r) => r.id)).toContain(auto.id);
    expect(undone.removedSessionIds).toContain(created.id);
    expect(startOf(data(await get(student, auto.id).expect(200)))).toBe(
      cal.gapStart,
    );
    await get(student, created.id).expect(404);
  });
});
