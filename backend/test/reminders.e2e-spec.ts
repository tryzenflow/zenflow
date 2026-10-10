import { Queue, type Job } from "bullmq";
import Redis from "ioredis";
import { PrismaClient } from "../generated/prisma";
import { NOTIFY_QUEUE, type NotifyJobData } from "../src/queue/queues";
import { connectDb } from "./queue/support/db";
import {
  QUEUE_REDIS,
  openSse,
  signUp,
  sleep,
  startRole,
  stop,
  until,
  type Proc,
  type Role,
  type Sse,
  type Student,
} from "./queue/support/stack";

/**
 * Reminders end to end: the API stores them, the watcher's sweep arms a delayed
 * job on the `notify` queue, the notify worker fires it into a notification row,
 * an SSE event and push jobs. One real clock-driven run: the single reminder
 * that must fire is set ~100 s ahead, and the sessions that must not fire share
 * its start, so they would have fired alongside it.
 *
 * Roles: `api`, `worker-notify` and (started late, so its boot sweep arms what
 * the test created) `watcher`.
 */
jest.setTimeout(300_000);

const SESSIONS = "/api/v1/sessions";
let prisma: PrismaClient;
let redis: Redis;
let notifyQ: Queue;
const procs: Partial<Record<Role, Proc>> = {};

beforeAll(async () => {
  prisma = connectDb();
  redis = new Redis({ ...QUEUE_REDIS, maxRetriesPerRequest: null });
  notifyQ = new Queue(NOTIFY_QUEUE.name, { connection: redis });
  await notifyQ.obliterate({ force: true });
  procs.api = await startRole("api");
  procs["worker-notify"] = await startRole("worker-notify");
}, 120_000);
afterAll(async () => {
  await Promise.all(Object.values(procs).map((p) => stop(p)));
  await notifyQ.close();
  redis.disconnect();
  await prisma.$disconnect();
});

const STATES = ["waiting", "active", "delayed", "completed", "failed", "prioritized"] as const;
const jobsFor = async (notificationId: string): Promise<Job[]> =>
  (await notifyQ.getJobs([...STATES])).filter(
    (j) => (j.data as NotifyJobData & { notificationId?: string }).notificationId === notificationId,
  );
const reminderJobsFor = async (reminderIds: string[]): Promise<Job[]> =>
  (await notifyQ.getJobs([...STATES])).filter((j) =>
    reminderIds.includes((j.data as { reminderId?: string }).reminderId ?? ""),
  );
const fired = (student: Student, sessionId?: string) =>
  prisma.notification.findMany({
    where: { userId: student.id, eventName: "reminder.fired", ...(sessionId ? { sessionId } : {}) },
  });

async function lecture(student: Student, title: string, startsInMs: number, reminders: number[]) {
  const res = await student.agent
    .post(SESSIONS)
    .send({
      type: "LECTURE",
      title,
      durationMinutes: 60,
      scheduledStartTime: new Date(Date.now() + startsInMs).toISOString(),
      reminders,
    })
    .expect(201);
  return (res.body as { data: { id: string; reminders: number[] } }).data;
}
const reminderIdsOf = async (sessionId: string) =>
  (await prisma.sessionReminder.findMany({ where: { sessionId } })).map((r) => r.id);

describe("the day a reminder is due", () => {
  let student: Student;
  let sse: Sse;
  const ids: Record<"fires" | "deleted" | "moved" | "later", string> = {} as never;

  beforeAll(async () => {
    student = await signUp("reminders");
    await (sse = openSse(student)).ready;
    // 3.5 minutes out with a 2-minute reminder: due in ~90 s, far enough that the
    // API doesn't treat it as already due (under a minute away is skipped).
    const SOON = 210_000;
    ids.fires = (await lecture(student, "Fires", SOON, [2])).id;
    ids.deleted = (await lecture(student, "Deleted", SOON, [2])).id;
    ids.moved = (await lecture(student, "Moved", SOON, [2])).id;
    ids.later = (await lecture(student, "Later", 3 * 3_600_000, [30])).id;
    // The sweep runs at the watcher's boot: everything above gets armed.
    procs.watcher = await startRole("watcher");
  }, 120_000);
  afterAll(() => sse?.close());

  it("arms a delayed job per reminder, with a stable id", async () => {
    const all = await Promise.all(Object.values(ids).map(reminderIdsOf));
    const reminderIds = all.flat();
    expect(reminderIds).toHaveLength(4);
    const jobs = await until("the sweep to arm 4 reminder jobs", async () => {
      const found = await reminderJobsFor(reminderIds);
      return found.length === 4 && found;
    }, 30_000);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(4);
    for (const job of jobs) expect(job.id).toMatch(/^reminder_/);
    // Every job waits for its own time.
    expect(await Promise.all(jobs.map((j) => j.isDelayed()))).toEqual([true, true, true, true]);
  });

  it("fires the reminder once, with a notification, an SSE event and push jobs", async () => {
    // Changes after arming: the armed jobs still exist and must now do nothing.
    await student.agent.delete(`${SESSIONS}/${ids.deleted}`).expect(200);
    await student.agent
      .patch(`${SESSIONS}/${ids.moved}`)
      .send({ scheduledStartTime: new Date(Date.now() + 2 * 3_600_000).toISOString() })
      .expect(200);

    const [note] = await until("the reminder to fire", async () => {
      const rows = await fired(student, ids.fires);
      return rows.length > 0 && rows;
    }, 180_000, 1_000);
    expect(note.title).toContain("Fires");
    expect(note.readAt).toBeNull();

    // The stored reminder is marked as delivered for this start.
    const [reminderId] = await reminderIdsOf(ids.fires);
    const reminder = await prisma.sessionReminder.findUniqueOrThrow({ where: { id: reminderId } });
    expect(reminder.firedForStart).not.toBeNull();

    // Live to the student's open stream.
    const event = await until("the SSE event", () => sse.events.find((e) => e.id === note.id), 10_000);
    expect(event).toMatchObject({ eventName: "reminder.fired", sessionId: ids.fires });

    // One push job per provider.
    const pushes = await until("push jobs", async () => {
      const found = await jobsFor(note.id);
      return found.length >= 2 && found;
    }, 15_000);
    expect(pushes.map((j) => j.id).sort()).toEqual(
      expect.arrayContaining([expect.stringContaining("fcm"), expect.stringContaining("apns")]),
    );

    // The other sessions share this start: give their jobs the jitter window.
    await sleep(15_000);
    expect(await fired(student, ids.fires)).toHaveLength(1);
  });

  it("does not remind about a session that was moved away", async () => {
    expect(await fired(student, ids.moved)).toHaveLength(0);
  });

  it("does not remind about a session the student deleted", async () => {
    expect(await fired(student, ids.deleted)).toHaveLength(0);
  });

  it("does not fire again when the watcher restarts and sweeps again", async () => {
    await stop(procs.watcher);
    procs.watcher = await startRole("watcher");
    await sleep(12_000);
    expect(await fired(student, ids.fires)).toHaveLength(1);
    const [reminderId] = await reminderIdsOf(ids.fires);
    expect(await reminderJobsFor([reminderId])).toHaveLength(1);
  });

  it("leaves a later reminder waiting", async () => {
    const [reminderId] = await reminderIdsOf(ids.later);
    const [job] = await reminderJobsFor([reminderId]);
    expect(job).toBeDefined();
    expect(await job.isDelayed()).toBe(true);
  });

  it("lets the student act on the fired reminder from the inbox", async () => {
    const [note] = await fired(student, ids.fires);
    const inbox = async () =>
      (
        (await student.agent.get("/api/v1/notifications").expect(200)).body as {
          data: { notifications: { id: string }[]; unreadCount: number };
        }
      ).data;
    const before = await inbox();
    expect(before.notifications.map((n) => n.id)).toContain(note.id);

    await student.agent.patch(`/api/v1/notifications/${note.id}/read`).expect(200);
    expect((await inbox()).unreadCount).toBe(before.unreadCount - 1);

    await student.agent.delete(`/api/v1/notifications/${note.id}`).expect(200);
    expect((await inbox()).notifications.map((n) => n.id)).not.toContain(note.id);
    expect(await fired(student, ids.fires)).toHaveLength(0);
  });
});

describe("a reminder that is already due", () => {
  it("is reported back instead of firing immediately", async () => {
    const student = await signUp("reminders-late");
    const res = await student.agent
      .post(SESSIONS)
      .send({
        type: "LECTURE",
        title: "Starts soon",
        durationMinutes: 60,
        scheduledStartTime: new Date(Date.now() + 5 * 60_000).toISOString(),
        reminders: [10],
      })
      .expect(201);
    expect((res.body as { data: { skippedReminders: number[] } }).data.skippedReminders).toEqual([10]);
    await sleep(2_000);
    expect(await fired(student)).toHaveLength(0);
  });
});
