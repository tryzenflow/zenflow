import type {
  CreateSessionResponse,
  DailyPushSettings,
  SessionCheckOffResponse,
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
 * Morning brief and evening check-in (#255) through the real API: the
 * settings endpoint (defaults, validation, switching off) and the evening
 * action path, which marks sessions through the complete and skip endpoints.
 */
jest.setTimeout(180_000);

const DAILY = "/api/v1/users/me/daily-push";
const SESSIONS = "/api/v1/sessions";
const SLOT = 15 * 60_000;

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

const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;

async function lecture(student: Student, title: string) {
  const start = Math.floor((Date.now() + 2 * 3_600_000) / SLOT) * SLOT;
  const res = await student.agent
    .post(SESSIONS)
    .send({
      type: "LECTURE",
      title,
      durationMinutes: 60,
      scheduledStartTime: new Date(start).toISOString(),
    })
    .expect(201);
  return data<CreateSessionResponse>(res);
}

describe("daily push settings", () => {
  it("is off by default", async () => {
    const student = await signUp("daily-default");
    const res = await student.agent.get(DAILY).expect(200);
    expect(data<DailyPushSettings>(res)).toEqual({
      morningBriefTime: null,
      eveningCheckinTime: null,
    });
  });

  it("saves both times and reads them back", async () => {
    const student = await signUp("daily-save");
    await student.agent
      .put(DAILY)
      .send({ morningBriefTime: "07:30", eveningCheckinTime: "21:00" })
      .expect(200);
    const res = await student.agent.get(DAILY).expect(200);
    expect(data<DailyPushSettings>(res)).toEqual({
      morningBriefTime: "07:30",
      eveningCheckinTime: "21:00",
    });
  });

  it("turns one push off with null and keeps the other", async () => {
    const student = await signUp("daily-off");
    await student.agent
      .put(DAILY)
      .send({ morningBriefTime: "07:30", eveningCheckinTime: "21:00" })
      .expect(200);
    await student.agent
      .put(DAILY)
      .send({ morningBriefTime: null, eveningCheckinTime: "21:00" })
      .expect(200);
    const res = await student.agent.get(DAILY).expect(200);
    expect(data<DailyPushSettings>(res)).toEqual({
      morningBriefTime: null,
      eveningCheckinTime: "21:00",
    });
  });

  it("rejects a malformed time", async () => {
    const student = await signUp("daily-bad-time");
    for (const bad of ["24:00", "7:00", "07:60", "noon"]) {
      await student.agent
        .put(DAILY)
        .send({ morningBriefTime: bad, eveningCheckinTime: null })
        .expect(400);
    }
  });

  it("rejects a body that leaves a key out", async () => {
    const student = await signUp("daily-missing");
    await student.agent
      .put(DAILY)
      .send({ morningBriefTime: "07:00" })
      .expect(400);
  });

  it("requires a signed-in user", async () => {
    await request(API_URL).get(DAILY).expect(401);
  });
});

describe("evening check-in action path", () => {
  it("marks a session done through the complete endpoint", async () => {
    const student = await signUp("daily-done");
    const s = await lecture(student, "Algorithms");
    const res = await student.agent
      .post(`${SESSIONS}/${encodeURIComponent(s.id)}/complete`)
      .expect(201);
    expect(data<SessionCheckOffResponse>(res).session.completedAt).not.toBeNull();
  });

  it("marks a session missed through the skip endpoint", async () => {
    const student = await signUp("daily-missed");
    const s = await lecture(student, "Databases");
    const res = await student.agent
      .post(`${SESSIONS}/${encodeURIComponent(s.id)}/skip`)
      .expect(201);
    expect(data<SessionCheckOffResponse>(res).session.skipped).toBe(true);
  });
});
