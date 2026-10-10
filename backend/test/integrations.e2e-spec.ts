import request from "supertest";
import { PrismaClient } from "../generated/prisma";
import { connectDb, integrationOf } from "./queue/support/db";
import {
  API_URL,
  signUp,
  startFake,
  startRole,
  stop,
  type Proc,
  type Student,
} from "./queue/support/stack";

/**
 * LMS / portal credentials end to end: connect, reconnect, update, status and
 * disconnect through the real API, with the fake DLU server as the upstream
 * login. Asserts what is stored (encrypted, never returned) as well as what is
 * answered. Each test signs up its own student.
 */
jest.setTimeout(180_000);

const INTEGRATIONS = "/api/v1/integrations";
const USERNAME = "3120410999";
const PASSWORD = "correct-horse-battery";

let api: Proc;
let fake: Proc | undefined;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = connectDb();
  fake = await startFake();
  api = await startRole("api");
});
afterAll(async () => {
  await stop(api);
  await stop(fake);
  await prisma.$disconnect();
});

const connectAs = (student: Student, over: Record<string, unknown> = {}) =>
  student.agent
    .post(INTEGRATIONS)
    .send({ provider: "PORTAL", username: USERNAME, password: PASSWORD, ...over });
const statusOf = async (student: Student) =>
  (
    (await student.agent.get(INTEGRATIONS).expect(200)).body as {
      data: { integrations: { provider: string; connected: boolean }[] };
    }
  ).data.integrations;
const rowCount = (student: Student, provider = "PORTAL") =>
  prisma.integration.count({
    where: { userId: student.id, provider: provider as "PORTAL" | "LMS" },
  });

describe("authentication", () => {
  it.each([
    ["GET", INTEGRATIONS],
    ["POST", INTEGRATIONS],
    ["PATCH", `${INTEGRATIONS}/PORTAL`],
    ["DELETE", `${INTEGRATIONS}/PORTAL`],
    ["POST", `${INTEGRATIONS}/PORTAL/sync`],
  ])("%s %s needs a login", async (method, url) => {
    const res = await request(API_URL)[method.toLowerCase() as "get"](url).send({});
    expect(res.status).toBe(401);
  });
});

describe("status", () => {
  it("lists both providers as not connected for a new student", async () => {
    const student = await signUp("status-new");
    const list = await statusOf(student);
    expect(list.map((i) => [i.provider, i.connected]).sort()).toEqual([
      ["LMS", false],
      ["PORTAL", false],
    ]);
  });

  it("only ever shows the caller's own accounts", async () => {
    const a = await signUp("status-a");
    const b = await signUp("status-b");
    await connectAs(a).expect(201);
    expect((await statusOf(b)).every((i) => !i.connected)).toBe(true);
    expect((await statusOf(a)).find((i) => i.provider === "PORTAL")?.connected).toBe(true);
  });
});

describe("connecting", () => {
  it("verifies the login, answers the account's status and never echoes the secret", async () => {
    const student = await signUp("connect");
    const res = await connectAs(student).expect(201);
    expect(res.body).toMatchObject({
      success: true,
      data: { provider: "PORTAL", connected: true },
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(USERNAME);
    const listed = JSON.stringify((await student.agent.get(INTEGRATIONS)).body);
    expect(listed).not.toContain(PASSWORD);
    expect(listed).not.toContain(USERNAME);
    expect((await statusOf(student)).find((i) => i.provider === "PORTAL")?.connected).toBe(true);
  });

  it("stores the credentials encrypted under a per-user key wrapped by the master key", async () => {
    const student = await signUp("encrypted");
    await connectAs(student).expect(201);
    const row = await integrationOf(prisma, student, "PORTAL");
    expect(row.encryptedCredentials).not.toContain(PASSWORD);
    expect(row.encryptedCredentials).not.toContain(USERNAME);
    expect(row.iv).toMatch(/^[0-9a-f]+$/);
    expect(row.authTag).toBeTruthy();
    const dek = await prisma.userEncryptionKey.findFirstOrThrow({
      where: { userId: student.id, provider: "PORTAL" },
    });
    expect(dek.version).toBe(row.encryptionVersion);
    expect(dek.key).not.toBe("");
    expect(dek.masterKeyVersion).toBeGreaterThanOrEqual(1);
  });

  it("seeds the rolling sync schedule", async () => {
    const student = await signUp("schedule");
    await connectAs(student).expect(201);
    const row = await integrationOf(prisma, student, "PORTAL");
    const kinds = (
      await prisma.ingestionSchedule.findMany({ where: { integrationId: row.id } })
    ).map((s) => s.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("rejects a wrong password and stores nothing", async () => {
    const student = await signUp("wrong-password");
    const res = await connectAs(student, { password: "wrongpass" }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/Could not sign in/);
    expect(await rowCount(student)).toBe(0);
    expect((await statusOf(student)).every((i) => !i.connected)).toBe(true);
  });

  it("reconnecting replaces the credentials without duplicating the account", async () => {
    const student = await signUp("reconnect");
    await connectAs(student).expect(201);
    const before = await integrationOf(prisma, student, "PORTAL");
    await connectAs(student, { password: "another-password" }).expect(201);
    const after = await integrationOf(prisma, student, "PORTAL");
    expect(await rowCount(student)).toBe(1);
    expect(after.id).toBe(before.id);
    expect(after.encryptedCredentials).not.toBe(before.encryptedCredentials);
    expect(after.iv).not.toBe(before.iv);
    const schedules = await prisma.ingestionSchedule.count({ where: { integrationId: after.id } });
    expect(schedules).toBeGreaterThan(0);
  });

  it("keeps LMS and portal accounts independent", async () => {
    const student = await signUp("both");
    await connectAs(student).expect(201);
    await connectAs(student, { provider: "LMS" }).expect(201);
    expect(await rowCount(student, "PORTAL")).toBe(1);
    expect(await rowCount(student, "LMS")).toBe(1);
    await student.agent.delete(`${INTEGRATIONS}/LMS`).expect(200);
    expect(await rowCount(student, "PORTAL")).toBe(1);
  });

  describe("validation", () => {
    let student: Student;
    beforeAll(async () => {
      student = await signUp("validate");
    });
    it.each([
      ["an unknown provider", { provider: "MOODLE" }],
      ["an empty username", { username: "" }],
      ["an empty password", { password: "" }],
      ["a username over 200 characters", { username: "u".repeat(201) }],
      ["a password over 1024 characters", { password: "p".repeat(1025) }],
      ["an unknown field", { role: "admin" }],
    ])("rejects %s", async (_label, over) => {
      await connectAs(student, over).expect(400);
      expect(await rowCount(student)).toBe(0);
    });
  });
});

describe("updating", () => {
  it("changes the password and keeps the username", async () => {
    const student = await signUp("update");
    await connectAs(student).expect(201);
    const before = await integrationOf(prisma, student, "PORTAL");
    const res = await student.agent
      .patch(`${INTEGRATIONS}/PORTAL`)
      .send({ password: "a-new-password" })
      .expect(200);
    expect(res.body).toMatchObject({ data: { provider: "PORTAL", connected: true } });
    const after = await integrationOf(prisma, student, "PORTAL");
    expect(after.encryptedCredentials).not.toBe(before.encryptedCredentials);
  });

  it("keeps the old credentials when the new ones don't sign in", async () => {
    const student = await signUp("update-bad");
    await connectAs(student).expect(201);
    const before = await integrationOf(prisma, student, "PORTAL");
    await student.agent
      .patch(`${INTEGRATIONS}/PORTAL`)
      .send({ password: "wrongpass" })
      .expect(400);
    const after = await integrationOf(prisma, student, "PORTAL");
    expect(after.encryptedCredentials).toBe(before.encryptedCredentials);
    expect(after.iv).toBe(before.iv);
  });

  it("needs both fields the first time", async () => {
    const student = await signUp("update-first");
    await student.agent.patch(`${INTEGRATIONS}/PORTAL`).send({ password: PASSWORD }).expect(400);
    expect(await rowCount(student)).toBe(0);
    await student.agent
      .patch(`${INTEGRATIONS}/PORTAL`)
      .send({ username: USERNAME, password: PASSWORD })
      .expect(200);
    expect(await rowCount(student)).toBe(1);
  });

  it("rejects an unknown provider", async () => {
    const student = await signUp("update-provider");
    await student.agent.patch(`${INTEGRATIONS}/MOODLE`).send({ password: PASSWORD }).expect(400);
  });
});

describe("disconnecting", () => {
  it("removes the account and its schedule", async () => {
    const student = await signUp("disconnect");
    await connectAs(student).expect(201);
    const row = await integrationOf(prisma, student, "PORTAL");
    const res = await student.agent.delete(`${INTEGRATIONS}/PORTAL`).expect(200);
    expect(res.body).toMatchObject({ data: { provider: "PORTAL", connected: false } });
    expect(await rowCount(student)).toBe(0);
    expect(await prisma.ingestionSchedule.count({ where: { integrationId: row.id } })).toBe(0);
    expect((await statusOf(student)).every((i) => !i.connected)).toBe(true);
  });

  it("is idempotent", async () => {
    const student = await signUp("disconnect-twice");
    await student.agent.delete(`${INTEGRATIONS}/PORTAL`).expect(200);
    await connectAs(student).expect(201);
    await student.agent.delete(`${INTEGRATIONS}/PORTAL`).expect(200);
    await student.agent.delete(`${INTEGRATIONS}/PORTAL`).expect(200);
  });

  it("can be connected again afterwards", async () => {
    const student = await signUp("disconnect-reconnect");
    await connectAs(student).expect(201);
    await student.agent.delete(`${INTEGRATIONS}/PORTAL`).expect(200);
    await connectAs(student).expect(201);
    expect(await rowCount(student)).toBe(1);
  });
});

describe("manual sync guards", () => {
  it("answers 404 for an account that isn't connected", async () => {
    const student = await signUp("sync-none");
    await student.agent.post(`${INTEGRATIONS}/PORTAL/sync`).expect(404);
  });

  it("answers 400 for an unknown provider", async () => {
    const student = await signUp("sync-provider");
    await student.agent.post(`${INTEGRATIONS}/MOODLE/sync`).expect(400);
  });
});

// Last: stops the fake upstream.
describe("when DLU is unreachable", () => {
  it("answers 503 and stores nothing", async () => {
    await stop(fake);
    fake = undefined;
    const student = await signUp("outage");
    const res = await connectAs(student).expect(503);
    expect(JSON.stringify(res.body)).toMatch(/Couldn't reach DLU/);
    expect(await rowCount(student)).toBe(0);
  });
});
