import type {
  CreateSessionResponse,
  Session,
  SessionCheckOffResponse,
  SessionsListResponse,
  StreakResponse,
} from "@zenflow/shared";
import request from "supertest";
import { PrismaClient } from "../generated/prisma";
import { connectDb } from "./queue/support/db";
import {
  API_URL,
  removeStudents,
  signUp,
  startRole,
  stop,
  type Proc,
  type Student,
} from "./queue/support/stack";

/**
 * Done and skipped state (#247) through the real API and Postgres:
 * complete, skip and undo on plain rows and recurring occurrences, the
 * `COMPLETE` / `SKIP` telemetry rows, and the daily streak.
 */
jest.setTimeout(180_000);

const SLOT = 15 * 60_000;
const DAY = 24 * 3_600_000;
const SESSIONS = "/api/v1/sessions";
const STREAK = "/api/v1/users/me/streak";

let api: Proc;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = connectDb();
  api = await startRole("api");
});
afterAll(async () => {
  await stop(api);
  await removeStudents(prisma);
  await prisma.$disconnect();
});

const iso = (ms: number) => new Date(ms).toISOString();
const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;
const path = (id: string, action: "complete" | "skip") =>
  `${SESSIONS}/${encodeURIComponent(id)}/${action}`;

async function lecture(student: Student, over: Record<string, unknown> = {}) {
  const start = Math.floor((Date.now() - 2 * 3_600_000) / SLOT) * SLOT;
  const res = await student.agent
    .post(SESSIONS)
    .send({
      type: "LECTURE",
      title: "Algorithms",
      durationMinutes: 60,
      scheduledStartTime: iso(start),
      ...over,
    })
    .expect(201);
  return data<CreateSessionResponse>(res);
}

async function events(sessionId: string) {
  return prisma.sessionEvent.findMany({
    where: { sessionId, eventType: { in: ["COMPLETE", "SKIP"] } },
    select: { eventType: true, newSnapshot: true },
  });
}

describe("completing a session", () => {
  it("round-trips complete and undo", async () => {
    const student = await signUp("done");
    const s = await lecture(student);

    const done = data<SessionCheckOffResponse>(
      await student.agent.post(path(s.id, "complete")).expect(201),
    );
    expect(done.session.id).toBe(s.id);
    expect(done.session.completedAt).not.toBeNull();
    expect(done.session.skipped).toBe(false);
    expect(done.streak).toMatchObject({ current: 1, todayDone: true });
    expect(await events(s.id)).toEqual([
      expect.objectContaining({ eventType: "COMPLETE" }),
    ]);

    const detail = data<Session>(
      await student.agent.get(`${SESSIONS}/${s.id}`).expect(200),
    );
    expect(detail.completedAt).toBe(done.session.completedAt);

    const undone = data<SessionCheckOffResponse>(
      await student.agent.delete(path(s.id, "complete")).expect(200),
    );
    expect(undone.session.completedAt).toBeNull();
    expect(undone.streak).toMatchObject({ current: 0, todayDone: false });
    expect(await events(s.id)).toEqual([]);
  });

  it("is idempotent", async () => {
    const student = await signUp("done-twice");
    const s = await lecture(student);
    const first = data<SessionCheckOffResponse>(
      await student.agent.post(path(s.id, "complete")).expect(201),
    );
    const second = data<SessionCheckOffResponse>(
      await student.agent.post(path(s.id, "complete")).expect(201),
    );
    expect(second.session.completedAt).toBe(first.session.completedAt);
    expect(await events(s.id)).toHaveLength(1);
  });

  it("skip replaces done, and undoing the skip leaves it open", async () => {
    const student = await signUp("skip");
    const s = await lecture(student);
    await student.agent.post(path(s.id, "complete")).expect(201);

    const skipped = data<SessionCheckOffResponse>(
      await student.agent.post(path(s.id, "skip")).expect(201),
    );
    expect(skipped.session).toMatchObject({ completedAt: null, skipped: true });
    expect(skipped.streak.current).toBe(0);
    expect(await events(s.id)).toEqual([
      expect.objectContaining({ eventType: "SKIP" }),
    ]);

    const open = data<SessionCheckOffResponse>(
      await student.agent.delete(path(s.id, "skip")).expect(200),
    );
    expect(open.session).toMatchObject({ completedAt: null, skipped: false });
    expect(await events(s.id)).toEqual([]);
  });

  it("404s another student's session", async () => {
    const owner = await signUp("owner");
    const other = await signUp("other");
    const s = await lecture(owner);
    await other.agent.post(path(s.id, "complete")).expect(404);
  });

  it("requires a login", async () => {
    await request(API_URL).post(path("any", "complete")).expect(401);
    await request(API_URL).get(STREAK).expect(401);
  });
});

describe("recurring occurrences", () => {
  it("marks one occurrence without touching the others", async () => {
    const student = await signUp("occ");
    const rep = await lecture(student, { rrule: "FREQ=DAILY;COUNT=5" });
    const occId = `${rep.seriesId}::${rep.scheduledStartTime}`;

    const done = data<SessionCheckOffResponse>(
      await student.agent.post(path(occId, "complete")).expect(201),
    );
    expect(done.session).toMatchObject({
      id: occId,
      scheduledStartTime: rep.scheduledStartTime,
    });
    expect(done.session.completedAt).not.toBeNull();

    const listed = data<SessionsListResponse>(
      await student.agent
        .get(SESSIONS)
        .query({ view: "week", date: rep.scheduledStartTime?.slice(0, 10) })
        .expect(200),
    ).sessions.filter((s) => s.seriesId === rep.seriesId);
    expect(listed.length).toBeGreaterThan(1);
    expect(
      listed.filter((s) => s.completedAt !== null).map((s) => s.id),
    ).toEqual([occId]);

    await student.agent.delete(path(occId, "complete")).expect(200);
    expect(
      await prisma.sessionOccurrenceState.count({
        where: { seriesId: rep.seriesId as string },
      }),
    ).toBe(0);
  });

  it("404s an occurrence the series does not produce", async () => {
    const student = await signUp("occ-404");
    const rep = await lecture(student, { rrule: "FREQ=DAILY;COUNT=2" });
    const start = Date.parse(rep.scheduledStartTime as string);
    const bogus = `${rep.seriesId}::${iso(start + 10 * DAY)}`;
    await student.agent.post(path(bogus, "complete")).expect(404);
  });
});

describe("GET /users/me/streak", () => {
  it("counts days with at least one completed session", async () => {
    const student = await signUp("streak");
    const a = await lecture(student, { title: "A" });
    const b = await lecture(student, { title: "B" });
    await student.agent.post(path(a.id, "complete")).expect(201);
    await student.agent.post(path(b.id, "complete")).expect(201);

    const streak = data<StreakResponse>(
      await student.agent.get(STREAK).expect(200),
    );
    expect(streak).toMatchObject({
      current: 1,
      longest: 1,
      freezesAvailable: 0,
      frozenDays: [],
      todayDone: true,
    });
  });
});
