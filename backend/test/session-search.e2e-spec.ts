import type {
  CreateSessionResponse,
  SessionSearchQuery,
  SessionSearchResponse,
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
 * `GET /sessions/search` (#241) through the real API and Postgres: matching on
 * title, note text, location and tags, paging both ways around an anchor,
 * and virtual occurrences of a recurring series.
 */
jest.setTimeout(180_000);

const DAY = 86_400_000;
const SLOT = 15 * 60_000;
const SESSIONS = "/api/v1/sessions";

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
/** A quarter-hour boundary at noon UTC today, so day offsets never collide. */
const base = () => Math.floor(Date.now() / DAY) * DAY + 12 * 3_600_000;

async function lecture(
  student: Student,
  at: number,
  over: Record<string, unknown> = {},
): Promise<CreateSessionResponse> {
  const res = await student.agent
    .post(SESSIONS)
    .send({
      type: "LECTURE",
      title: "Algorithms",
      durationMinutes: 60,
      scheduledStartTime: iso(Math.round(at / SLOT) * SLOT),
      ...over,
    })
    .expect(201);
  return (res.body as { data: CreateSessionResponse }).data;
}

async function search(
  student: Student,
  query: SessionSearchQuery,
): Promise<SessionSearchResponse> {
  const res = await student.agent
    .get(`${SESSIONS}/search`)
    .query(query)
    .expect(200);
  return (res.body as { data: SessionSearchResponse }).data;
}

describe("GET /sessions/search", () => {
  it("finds a session from 2 months ago by a word in its note", async () => {
    const student = await signUp("search-note");
    const old = await lecture(student, base() - 60 * DAY, {
      title: "Physics",
      note: "<p>Bring the <strong>oscilloscope</strong> probes</p>",
    });
    await lecture(student, base() - 59 * DAY, { title: "Physics" });

    const back = await search(student, {
      q: "Oscilloscope",
      anchor: iso(Date.now()),
      direction: "backward",
    });
    expect(back.sessions.map((s) => s.id)).toEqual([old.id]);
    expect(back.nextCursor).toBeNull();

    const forward = await search(student, { q: "oscilloscope" });
    expect(forward.sessions).toEqual([]);

    // Note markup is not searchable text.
    const markup = await search(student, {
      q: "strong",
      direction: "backward",
    });
    expect(markup.sessions).toEqual([]);
  });

  it("matches title, location and tags, every word", async () => {
    const student = await signUp("search-fields");
    const byLocation = await lecture(student, base() + DAY, {
      title: "Chemistry",
      location: "Room B204",
    });
    const byTag = await lecture(student, base() + 2 * DAY, {
      title: "Biology",
      tags: ["midterm"],
    });

    const loc = await search(student, { q: "b204" });
    expect(loc.sessions.map((s) => s.id)).toEqual([byLocation.id]);
    const tag = await search(student, { q: "MIDTERM biology" });
    expect(tag.sessions.map((s) => s.id)).toEqual([byTag.id]);
    const none = await search(student, { q: "midterm chemistry" });
    expect(none.sessions).toEqual([]);
  });

  it("pages forward and backward around the anchor", async () => {
    const student = await signUp("search-paging");
    const anchor = base();
    const days = [-3, -2, -1, 1, 2, 3];
    const made = new Map<number, string>();
    for (const d of days) {
      const s = await lecture(student, anchor + d * DAY, {
        title: `Lab report ${d}`,
      });
      made.set(d, s.id);
    }
    await lecture(student, anchor + 4 * DAY, { title: "Unrelated" });
    const ids = (ds: number[]) => ds.map((d) => made.get(d));

    const f1 = await search(student, {
      q: "lab",
      anchor: iso(anchor),
      limit: 2,
    });
    expect(f1.sessions.map((s) => s.id)).toEqual(ids([1, 2]));
    expect(f1.nextCursor).not.toBeNull();
    const f2 = await search(student, {
      q: "lab",
      cursor: f1.nextCursor as string,
      limit: 2,
    });
    expect(f2.sessions.map((s) => s.id)).toEqual(ids([3]));
    expect(f2.nextCursor).toBeNull();

    const b1 = await search(student, {
      q: "lab",
      anchor: iso(anchor),
      direction: "backward",
      limit: 2,
    });
    expect(b1.sessions.map((s) => s.id)).toEqual(ids([-2, -1]));
    const b2 = await search(student, {
      q: "lab",
      cursor: b1.nextCursor as string,
      direction: "backward",
      limit: 2,
    });
    expect(b2.sessions.map((s) => s.id)).toEqual(ids([-3]));
    expect(b2.nextCursor).toBeNull();

    // An empty query lists every session around the anchor.
    const all = await search(student, { anchor: iso(anchor), limit: 50 });
    expect(all.sessions).toHaveLength(4);
    expect(all.sessions.at(-1)?.title).toBe("Unrelated");
  });

  it("includes virtual occurrences of a recurring series", async () => {
    const student = await signUp("search-rrule");
    const start = base() + DAY;
    const rep = await lecture(student, start, {
      title: "Seminar",
      rrule: "FREQ=WEEKLY;COUNT=4",
    });
    const p1 = await search(student, {
      q: "seminar",
      anchor: iso(base()),
      limit: 3,
    });
    expect(p1.sessions.map((s) => s.scheduledStartTime)).toEqual(
      [0, 7, 14].map((d) => iso(start + d * DAY)),
    );
    expect(p1.sessions[0].id).toBe(`${rep.seriesId}::${iso(start)}`);
    const p2 = await search(student, {
      q: "seminar",
      cursor: p1.nextCursor as string,
      limit: 3,
    });
    expect(p2.sessions.map((s) => s.scheduledStartTime)).toEqual([
      iso(start + 21 * DAY),
    ]);
    expect(p2.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor and needs a session", async () => {
    const student = await signUp("search-bad");
    await student.agent
      .get(`${SESSIONS}/search`)
      .query({ cursor: "nope" })
      .expect(400);
    await request(API_URL).get(`${SESSIONS}/search`).expect(401);
  });
});
