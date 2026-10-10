import { PrismaClient } from "../generated/prisma";
import { connectDb, noteRows } from "./queue/support/db";
import {
  FAKE_URL,
  connect,
  signUp,
  sleep,
  startFake,
  startRole,
  stop,
  TUNING,
  until,
  type Proc,
  type Role,
  type Student,
} from "./queue/support/stack";

/**
 * What a sync does to the calendar and the inbox, end to end: the API, the
 * portal and LMS fetch workers and the notify worker over real Postgres and
 * Redis, with the fake DLU server as the upstream. Syncs are driven by
 * `POST /integrations/:provider/sync`, so the ticker (watcher role) is not
 * needed. The queue plumbing itself (retries, breaker, drain) is in
 * `queue/queue-flow.e2e-spec.ts`.
 *
 * Each test signs up its own student. The fake's `POST /_/hide` hook makes the
 * upstream withdraw items, which is how removal is exercised.
 */
jest.setTimeout(240_000);

const DAY = 86_400_000;
const ROLES: Role[] = ["api", "worker-portal", "worker-lms", "worker-notify"];
const procs: Proc[] = [];
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = connectDb();
  procs.push(await startFake());
  for (const role of ROLES) procs.push(await startRole(role));
}, 180_000);
afterAll(async () => {
  await Promise.all(procs.map((p) => stop(p)));
  await prisma.$disconnect();
});
afterEach(() => hide({ lms: false, exams: false, timetable: false }));

const hide = (items: Partial<Record<"lms" | "exams" | "timetable", boolean>>) =>
  fetch(`${FAKE_URL}/_/hide`, { method: "POST", body: JSON.stringify(items) });

interface SessionDto {
  id: string;
  title: string;
  type: "TASK" | "ASSIGNMENT" | "EXAM" | "LECTURE" | "DND";
  source: "USER" | "LMS" | "PORTAL";
  scheduledStartTime: string;
  durationMinutes: number;
  deadline: string | null;
}

/** Every session in the two months around now (the fake serves the current term). */
async function calendar(student: Student): Promise<SessionDto[]> {
  const found = new Map<string, SessionDto>();
  for (const offset of [0, 30]) {
    const res = await student.agent
      .get("/api/v1/sessions")
      .query({
        view: "month",
        date: new Date(Date.now() + offset * DAY).toISOString().slice(0, 10),
      })
      .expect(200);
    for (const s of (res.body as { data: { sessions: SessionDto[] } }).data.sessions) {
      found.set(s.id, s);
    }
  }
  return [...found.values()];
}
const ingested = async (student: Student) =>
  (await calendar(student)).filter((s) => s.source !== "USER");
const upcoming = (sessions: SessionDto[]) =>
  sessions.filter((s) => Date.parse(s.scheduledStartTime) > Date.now());
const tally = (sessions: SessionDto[]) =>
  sessions.reduce<Record<string, number>>((acc, s) => {
    const key = `${s.source}/${s.type}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

/** One manual sync of `provider`, waiting out the cooldown from the previous one. */
async function sync(student: Student, provider: "PORTAL" | "LMS", cooldown = false) {
  if (cooldown) await sleep((TUNING.cooldownSec + 0.5) * 1000);
  const res = await student.agent.post(`/api/v1/integrations/${provider}/sync`);
  expect([201, 202]).toContain(res.status);
  return res;
}
async function syncAll(student: Student, cooldown = false) {
  await sync(student, "PORTAL", cooldown);
  await sync(student, "LMS", false);
}
async function connectedStudent(label: string) {
  const student = await signUp(label);
  await connect(student, "PORTAL");
  await connect(student, "LMS");
  return student;
}
const inbox = async (student: Student) =>
  (await noteRows(prisma, student)).map((n) => n.eventName).sort();

describe("the first sync", () => {
  it("puts the school's items on the calendar, marked with where they came from", async () => {
    const student = await connectedStudent("first");
    expect(await ingested(student)).toEqual([]);
    await syncAll(student);
    const items = await ingested(student);
    const counts = tally(items);
    expect(counts["LMS/ASSIGNMENT"]).toBeGreaterThan(0);
    expect(counts["LMS/EXAM"]).toBeGreaterThan(0); // quizzes
    expect(counts["PORTAL/LECTURE"]).toBeGreaterThan(0);
    expect(counts["PORTAL/EXAM"]).toBeGreaterThan(0);
    for (const s of items) {
      expect(s.scheduledStartTime).toBeTruthy();
      expect(s.durationMinutes % 15).toBe(0);
      expect(s.deadline).toBeNull();
    }
  });

  it("reports each pass as completed", async () => {
    const student = await connectedStudent("status");
    const res = await sync(student, "PORTAL");
    expect(res.body).toMatchObject({
      success: true,
      data: { provider: "PORTAL", connected: true, lastSyncStatus: "COMPLETED", failing: false },
    });
  });

  it("raises one digest per kind of change, each pointing at a real session", async () => {
    const student = await connectedStudent("digest");
    await syncAll(student);
    const rows = await noteRows(prisma, student);
    const names = rows.map((n) => n.eventName);
    expect(names).toEqual(
      expect.arrayContaining([
        "assignment.group_created",
        "exam.group_created",
        "lecture.group_created",
      ]),
    );
    // One digest per source and kind: LMS assignments, LMS quizzes, portal exams, portal lectures.
    expect(names.filter((n) => n === "exam.group_created")).toHaveLength(2);
    expect(rows).toHaveLength(4);
    const known = new Set((await ingested(student)).map((s) => s.id));
    for (const row of rows) {
      expect(row.sessionId).not.toBeNull();
      expect(known.has(row.sessionId as string)).toBe(true);
      expect(row.readAt).toBeNull();
    }
  });

  it("shows the digests in the student's inbox, newest first", async () => {
    const student = await connectedStudent("inbox");
    await syncAll(student);
    const res = await student.agent.get("/api/v1/notifications").expect(200);
    const body = (res.body as { data: { notifications: { eventName: string; sentAt: string }[]; unreadCount: number } }).data;
    expect(body.notifications.length).toBeGreaterThan(0);
    expect(body.unreadCount).toBe(body.notifications.length);
    const times = body.notifications.map((n) => Date.parse(n.sentAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("keeps each student's calendar and inbox their own", async () => {
    const a = await connectedStudent("iso-a");
    const b = await signUp("iso-b");
    await syncAll(a);
    expect((await ingested(a)).length).toBeGreaterThan(0);
    expect(await ingested(b)).toEqual([]);
    expect(await inbox(b)).toEqual([]);
  });
});

describe("syncing again", () => {
  it("changes nothing when the school's data hasn't changed", async () => {
    const student = await connectedStudent("rerun");
    await syncAll(student);
    const before = (await ingested(student)).map((s) => s.id).sort();
    const notes = await inbox(student);
    await syncAll(student, true);
    expect((await ingested(student)).map((s) => s.id).sort()).toEqual(before);
    expect(await inbox(student)).toEqual(notes);
  });

  it("does not bring back an item the student deleted", async () => {
    const student = await connectedStudent("own-delete");
    await syncAll(student);
    const [victim] = (await ingested(student)).filter((s) => s.type === "ASSIGNMENT");
    await student.agent.delete(`/api/v1/sessions/${victim.id}`).expect(200);
    await syncAll(student, true);
    expect((await calendar(student)).map((s) => s.id)).not.toContain(victim.id);
    expect((await calendar(student)).some((s) => s.title === victim.title && s.type === "ASSIGNMENT")).toBe(false);
  });
});

describe("when the school withdraws items", () => {
  it("takes upcoming ones off the calendar, keeps the past, and tells the student", async () => {
    const student = await connectedStudent("withdraw");
    await syncAll(student);
    const before = await ingested(student);
    expect(tally(upcoming(before))["PORTAL/LECTURE"]).toBeGreaterThan(0);
    await hide({ lms: true, exams: true, timetable: true });
    await syncAll(student, true);
    const after = await ingested(student);
    expect(upcoming(after)).toEqual([]);
    // What already happened stays as history.
    expect(after.length).toBe(before.length - upcoming(before).length);
    expect(await inbox(student)).toEqual(
      expect.arrayContaining([
        "assignment.group_removed",
        "exam.group_removed",
        "lecture.group_removed",
      ]),
    );
  });

  it("only removes what was withdrawn", async () => {
    const student = await connectedStudent("partial");
    await syncAll(student);
    const before = tally(upcoming(await ingested(student)));
    await hide({ exams: true });
    await sync(student, "PORTAL", true);
    const after = tally(upcoming(await ingested(student)));
    expect(after["PORTAL/EXAM"]).toBeUndefined();
    expect(after["PORTAL/LECTURE"]).toBe(before["PORTAL/LECTURE"]);
    expect(after["LMS/ASSIGNMENT"]).toBe(before["LMS/ASSIGNMENT"]);
  });

  it("never touches the student's own sessions", async () => {
    const student = await connectedStudent("own");
    const created = await student.agent
      .post("/api/v1/sessions")
      .send({
        type: "TASK",
        title: "Mine",
        durationMinutes: 60,
        deadline: new Date(Date.now() + 5 * DAY).toISOString(),
      })
      .expect(201);
    const id = (created.body as { data: { id: string } }).data.id;
    await syncAll(student);
    await hide({ lms: true, exams: true, timetable: true });
    await syncAll(student, true);
    expect((await calendar(student)).map((s) => s.id)).toContain(id);
  });
});

describe("when a sync lands on the student's own task", () => {
  /** Next Monday 00:30 UTC: where the fake's weekly timetable puts a lecture. */
  const nextMondayLecture = () => {
    const d = new Date();
    d.setUTCHours(0, 30, 0, 0);
    do d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() !== 1);
    return d;
  };

  async function taskAt(student: Student, start: Date) {
    const created = await student.agent
      .post("/api/v1/sessions")
      .send({
        type: "TASK",
        title: "Revise graphs",
        durationMinutes: 60,
        deadline: new Date(start.getTime() + 20 * DAY).toISOString(),
      })
      .expect(201);
    const id = (created.body as { data: { id: string } }).data.id;
    await student.agent
      .patch(`/api/v1/sessions/${id}`)
      .send({ scheduledStartTime: start.toISOString() })
      .expect(200);
    return id;
  }
  const conflicts = (student: Student) =>
    prisma.notification.findMany({
      where: { userId: student.id, eventName: { startsWith: "sync_conflict." } },
    });

  it("warns once, naming the task, and reschedules it on request", async () => {
    const student = await connectedStudent("conflict");
    const taskId = await taskAt(student, nextMondayLecture());
    await syncAll(student);

    const rows = await until("a conflict notification", async () => {
      const r = await conflicts(student);
      return r.length > 0 && r;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventName).toBe("sync_conflict.lecture");
    expect(rows[0].conflictSessionIds).toEqual([taskId]);

    // A repeat sync doesn't raise the same warning again.
    await syncAll(student, true);
    expect(await conflicts(student)).toHaveLength(1);

    const res = await student.agent
      .post(`/api/v1/notifications/${rows[0].id}/reschedule-conflicts`)
      .expect(201);
    const body = (res.body as { data: { rescheduled: { id: string }[]; failedSessionIds: string[] } }).data;
    expect(body.rescheduled.map((r) => r.id)).toEqual([taskId]);
    expect(body.failedSessionIds).toEqual([]);

    const all = await calendar(student);
    const task = all.find((s) => s.id === taskId) as SessionDto;
    const start = Date.parse(task.scheduledStartTime);
    const end = start + task.durationMinutes * 60_000;
    const clashes = all.filter(
      (s) =>
        s.id !== taskId &&
        s.source !== "USER" &&
        Date.parse(s.scheduledStartTime) < end &&
        start < Date.parse(s.scheduledStartTime) + s.durationMinutes * 60_000,
    );
    expect(clashes).toEqual([]);

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(after.actionTakenAt).not.toBeNull();
  });

  it("rescheduling twice is harmless", async () => {
    const student = await connectedStudent("conflict-twice");
    await taskAt(student, nextMondayLecture());
    await syncAll(student);
    const [row] = await until("a conflict notification", async () => {
      const r = await conflicts(student);
      return r.length > 0 && r;
    });
    await student.agent.post(`/api/v1/notifications/${row.id}/reschedule-conflicts`).expect(201);
    const before = (await calendar(student)).map((s) => [s.id, s.scheduledStartTime]);
    await student.agent.post(`/api/v1/notifications/${row.id}/reschedule-conflicts`).expect(201);
    expect((await calendar(student)).map((s) => [s.id, s.scheduledStartTime])).toEqual(before);
  });

  it("won't reschedule for another student's notification", async () => {
    const owner = await connectedStudent("conflict-owner");
    const other = await signUp("conflict-other");
    await taskAt(owner, nextMondayLecture());
    await syncAll(owner);
    const [row] = await until("a conflict notification", async () => {
      const r = await conflicts(owner);
      return r.length > 0 && r;
    });
    const res = await other.agent.post(`/api/v1/notifications/${row.id}/reschedule-conflicts`);
    expect([403, 404]).toContain(res.status);
  });
});
