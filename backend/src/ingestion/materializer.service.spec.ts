import type { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { MaterializerService } from "./materializer.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TagsService } from "../tags/tags.service";
import type { ParsedBlock, ParsedLmsItem } from "./core/types";

// ── in-memory Prisma double ────────────────────────────────────────────────
// Same idiom as integrations.service.spec.ts: a real object graph rather than
// assertions on call arguments, so "one Session, one Notification after two
// runs" is checked against what is actually stored.

interface SessionRow {
  id: string;
  userId: string;
  externalKey: string | null;
  title: string;
  note: string | null;
  location: string | null;
  type: string;
  source: string;
  durationMinutes: number;
  scheduledStartTime: Date | null;
  lastMovedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tags: { name: string }[];
  series: null;
}

interface NotificationRow {
  id: string;
  userId: string;
  sessionId: string | null;
  topic: string;
  kind: string;
  title: string;
  content: string;
  eventEndsAt: Date | null;
}

/** The subset of Prisma `where` operators the materializer actually uses. */
function matchesWhere(
  row: SessionRow,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "externalKey" && isPlainObject(cond) && "not" in cond) {
      return row.externalKey !== cond.not;
    }
    if (key === "type" && isPlainObject(cond) && Array.isArray(cond.in)) {
      return (cond.in as string[]).includes(row.type);
    }
    if (key === "scheduledStartTime" && isPlainObject(cond)) {
      const at = row.scheduledStartTime?.getTime() ?? -Infinity;
      if ("gte" in cond && at < (cond.gte as Date).getTime()) return false;
      if ("lte" in cond && at > (cond.lte as Date).getTime()) return false;
      return true;
    }
    return (row as unknown as Record<string, unknown>)[key] === cond;
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function makePrismaDouble() {
  const sessions: SessionRow[] = [];
  const notifications: NotificationRow[] = [];
  const events: Record<string, unknown>[] = [];
  const tags: { id: string; userId: string; name: string }[] = [];

  const client = {
    // Enough of `tag` for `TagsService.resolveTagIds` — find-or-create by name.
    tag: {
      createMany: (args: {
        data: { userId: string; name: string }[];
        skipDuplicates?: boolean;
      }) => {
        for (const d of args.data) {
          if (!tags.some((t) => t.userId === d.userId && t.name === d.name)) {
            tags.push({
              id: `t${tags.length + 1}`,
              userId: d.userId,
              name: d.name,
            });
          }
        }
        return Promise.resolve({ count: args.data.length });
      },
      findMany: (args: { where: { userId: string; name: { in: string[] } } }) =>
        Promise.resolve(
          tags
            .filter(
              (t) =>
                t.userId === args.where.userId &&
                args.where.name.in.includes(t.name),
            )
            .map((t) => ({ id: t.id })),
        ),
    },
    session: {
      findUnique: (args: {
        where: { userId_externalKey: { userId: string; externalKey: string } };
      }) => {
        const { userId, externalKey } = args.where.userId_externalKey;
        return Promise.resolve(
          sessions.find(
            (s) => s.userId === userId && s.externalKey === externalKey,
          ) ?? null,
        );
      },
      create: (args: { data: Record<string, unknown> }) => {
        const data = args.data;
        const externalKey = (data.externalKey as string | null) ?? null;
        const userId = data.userId as string;
        if (
          externalKey !== null &&
          sessions.some(
            (s) => s.userId === userId && s.externalKey === externalKey,
          )
        ) {
          // What Postgres does when the [userId, externalKey] unique index is
          // violated — the race signal the materializer swallows.
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError("Unique constraint", {
              code: "P2002",
              clientVersion: "6",
            }),
          );
        }
        const row: SessionRow = {
          id: `s${sessions.length + 1}`,
          userId,
          externalKey,
          title: data.title as string,
          note: (data.note as string | null) ?? null,
          location: (data.location as string | null) ?? null,
          type: data.type as string,
          source: data.source as string,
          durationMinutes: data.durationMinutes as number,
          scheduledStartTime: (data.scheduledStartTime as Date) ?? null,
          lastMovedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: (
            (data.tags as { connect?: { id: string }[] } | undefined)
              ?.connect ?? []
          ).map(({ id }) => ({
            name: tags.find((t) => t.id === id)?.name ?? id,
          })),
          series: null,
        };
        sessions.push(row);
        return Promise.resolve(row);
      },
      update: (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = sessions.find((s) => s.id === args.where.id);
        if (!row) throw new Error(`no session ${args.where.id}`);
        Object.assign(row, args.data);
        return Promise.resolve(row);
      },
      // Enough of `findMany` / `count` / `delete` for the reconciliation +
      // grouping paths: filter on userId, source, type (plain or `{ in }`),
      // externalKey `{ not: null }`, and a `scheduledStartTime` `{ gte, lte }`.
      findMany: (args: { where: Record<string, unknown> }) =>
        Promise.resolve(sessions.filter((s) => matchesWhere(s, args.where))),
      count: (args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          sessions.filter((s) => matchesWhere(s, args.where)).length,
        ),
      delete: (args: { where: { id: string } }) => {
        const i = sessions.findIndex((s) => s.id === args.where.id);
        if (i === -1) throw new Error(`no session ${args.where.id}`);
        const [row] = sessions.splice(i, 1);
        return Promise.resolve(row);
      },
    },
    sessionEvent: {
      create: (args: { data: Record<string, unknown> }) => {
        events.push(args.data);
        return Promise.resolve({ id: BigInt(events.length) });
      },
    },
    notification: {
      create: (args: { data: Record<string, unknown> }) => {
        const row: NotificationRow = {
          id: `n${notifications.length + 1}`,
          userId: args.data.userId as string,
          sessionId: (args.data.sessionId as string | null) ?? null,
          topic: args.data.topic as string,
          kind: (args.data.kind as string) ?? "NEW",
          title: args.data.title as string,
          content: args.data.content as string,
          eventEndsAt: (args.data.eventEndsAt as Date | null) ?? null,
        };
        notifications.push(row);
        return Promise.resolve(row);
      },
      findFirst: (args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          notifications.find((n) =>
            Object.entries(args.where).every(
              ([k, v]) => (n as unknown as Record<string, unknown>)[k] === v,
            ),
          ) ?? null,
        ),
    },
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(client),
  };

  return { client, sessions, notifications, events, tags };
}

// ── fixtures (deliberately fictional — never real DLU data) ────────────────
const USER = "u1";

function block(over: Partial<ParsedBlock> = {}): ParsedBlock {
  return {
    externalKey: "lms:assign:800001",
    title: "Môn học Mẫu Một — bài tập 1",
    type: "ASSIGNMENT",
    scheduledStartTime: new Date("2026-09-10T03:00:00.000Z"),
    durationMinutes: 15,
    location: null,
    note: null,
    ...over,
  };
}

function makeService() {
  const db = makePrismaDouble();
  const prisma = db.client as unknown as PrismaService;
  const tagsService = new TagsService(prisma);
  // The real service — its `create` writes through the same `notification`
  // double, and `notify` just emits on an in-process EventEmitter2 nobody
  // here listens to.
  const notifications = new NotificationsService(prisma);
  const config = {
    get: (name: string) => (name === "DLU_TZ" ? "Asia/Ho_Chi_Minh" : undefined),
  } as unknown as ConfigService;
  const service = new MaterializerService(
    prisma,
    tagsService,
    notifications,
    config,
  );
  return { db, service };
}

/** A lecture block for a DLU term (`now` in the tests sits in HK01 2026). */
function lecture(over: Partial<ParsedBlock> = {}): ParsedBlock {
  return block({
    externalKey: "portal:meeting:700001",
    title: "Môn học Mẫu Một — buổi học",
    type: "LECTURE",
    scheduledStartTime: new Date("2026-09-10T02:00:00.000Z"),
    location: "X01.01",
    ...over,
  });
}

/** An instant inside HK01 of the 2026–2027 DLU academic year. */
const IN_TERM = new Date("2026-09-08T00:00:00.000Z");

describe("MaterializerService", () => {
  describe("create", () => {
    it("writes the session, its CREATE event and one notification", async () => {
      const { db, service } = makeService();

      const outcome = await service.materialize(USER, [block()], "LMS");

      expect(outcome).toEqual({
        created: 1,
        updated: 0,
        unchanged: 0,
        guarded: 0,
      });
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0]).toMatchObject({
        userId: USER,
        source: "LMS",
        type: "ASSIGNMENT",
        externalKey: "lms:assign:800001",
        durationMinutes: 15,
      });
      // Ingested rows join the same audit trail as user-pinned ones.
      expect(db.events).toHaveLength(1);
      expect(db.events[0]).toMatchObject({ eventType: "CREATE" });

      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0]).toMatchObject({
        topic: "ASSIGNMENT",
        sessionId: db.sessions[0].id,
      });
    });

    it("tags the session with the LMS course's full name", async () => {
      const { db, service } = makeService();

      const lmsItem: ParsedLmsItem = {
        ...block({ externalKey: "lms:assign:800009" }),
        lmsCourse: {
          lmsCourseId: 90002,
          fullName: "Môn học Mẫu Ba - MHK99PM",
          shortName: "MHK99PM",
        },
      };

      await service.materialize(USER, [lmsItem], "LMS");

      expect(db.sessions[0].tags).toEqual([
        { name: "Môn học Mẫu Ba - MHK99PM" },
      ]);
      expect(db.tags.map((t) => t.name)).toEqual(["Môn học Mẫu Ba - MHK99PM"]);
    });

    it("adds no tag when the LMS item carries no course", async () => {
      const { db, service } = makeService();

      const lmsItem: ParsedLmsItem = {
        ...block({ externalKey: "lms:assign:800010" }),
        lmsCourse: null,
      };

      await service.materialize(USER, [lmsItem], "LMS");

      expect(db.sessions[0].tags).toEqual([]);
      expect(db.tags).toHaveLength(0);
    });

    it("writes the room to the location column and leaves the note untouched", async () => {
      const { db, service } = makeService();

      await service.materialize(
        USER,
        [
          block({
            externalKey: "portal:meeting:600001",
            type: "LECTURE",
            location: "X01.01",
            note: null,
          }),
        ],
        "PORTAL",
      );

      expect(db.sessions[0].location).toBe("X01.01");
      expect(db.sessions[0].note).toBeNull();
    });

    it("maps EXAM and LECTURE onto their notification topics", async () => {
      const { db, service } = makeService();

      await service.materialize(
        USER,
        [
          block({ externalKey: "portal:exam:500001", type: "EXAM" }),
          block({ externalKey: "portal:meeting:600001", type: "LECTURE" }),
        ],
        "PORTAL",
      );

      expect(db.notifications.map((n) => n.topic)).toEqual([
        "EXAM",
        "TIMETABLE",
      ]);
    });

    it("treats a P2002 race as a no-op rather than an error", async () => {
      const { db, service } = makeService();
      // Pretend a concurrent run inserted the row between our findUnique and
      // our create: the double rejects the second insert with P2002.
      db.sessions.push({
        id: "s0",
        userId: USER,
        externalKey: "lms:assign:800001",
        title: "already there",
        note: null,
        location: null,
        type: "ASSIGNMENT",
        source: "LMS",
        durationMinutes: 15,
        scheduledStartTime: new Date("2026-09-10T03:00:00.000Z"),
        lastMovedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: [],
        series: null,
      });
      const findUnique = jest
        .spyOn(db.client.session, "findUnique")
        .mockResolvedValueOnce(null);

      const outcome = await service.materialize(USER, [block()], "LMS");

      expect(findUnique).toHaveBeenCalled();
      expect(outcome.created).toBe(0);
      expect(outcome.unchanged).toBe(1);
      expect(db.sessions).toHaveLength(1);
      expect(db.notifications).toHaveLength(0);
    });
  });

  describe("idempotency", () => {
    it("is a no-op on a re-run: one session, one notification", async () => {
      const { db, service } = makeService();
      const items = [block()];

      const first = await service.materialize(USER, items, "LMS");
      const second = await service.materialize(USER, items, "LMS");

      expect(first.created).toBe(1);
      expect(second).toEqual({
        created: 0,
        updated: 0,
        unchanged: 1,
        guarded: 0,
      });
      expect(db.sessions).toHaveLength(1);
      expect(db.notifications).toHaveLength(1);
      expect(db.events).toHaveLength(1);
    });
  });

  describe("upstream change", () => {
    it("follows a move on a session the student has never touched", async () => {
      const { db, service } = makeService();
      await service.materialize(USER, [block()], "LMS");

      const moved = block({
        scheduledStartTime: new Date("2026-09-11T03:00:00.000Z"),
      });
      const outcome = await service.materialize(USER, [moved], "LMS");

      expect(outcome.updated).toBe(1);
      expect(db.sessions[0].scheduledStartTime).toEqual(
        new Date("2026-09-11T03:00:00.000Z"),
      );
      expect(db.notifications).toHaveLength(2);
      expect(db.notifications[1].title).toContain("Updated:");
      // Not a user action, so it must not enter the ML event trail...
      expect(db.events).toHaveLength(1);
      // ...nor claim the student moved it.
      expect(db.sessions[0].lastMovedAt).toBeNull();
    });

    it("settles down: the run after an upstream change is unchanged again", async () => {
      const { db, service } = makeService();
      await service.materialize(USER, [block()], "LMS");
      const moved = block({
        scheduledStartTime: new Date("2026-09-11T03:00:00.000Z"),
      });
      await service.materialize(USER, [moved], "LMS");

      const third = await service.materialize(USER, [moved], "LMS");

      expect(third.unchanged).toBe(1);
      expect(db.notifications).toHaveLength(2);
    });

    it("notices a title-only change", async () => {
      const { db, service } = makeService();
      await service.materialize(USER, [block()], "LMS");

      const outcome = await service.materialize(
        USER,
        [block({ title: "Môn học Mẫu Một — bài tập 1 (gia hạn)" })],
        "LMS",
      );

      expect(outcome.updated).toBe(1);
      expect(db.sessions[0].title).toBe(
        "Môn học Mẫu Một — bài tập 1 (gia hạn)",
      );
    });
  });

  describe("don't clobber a student's edit", () => {
    it("leaves a moved session alone and raises a TIMETABLE notification", async () => {
      const { db, service } = makeService();
      await service.materialize(USER, [block()], "LMS");
      // The student dragged it, so the row carries their fingerprint.
      db.sessions[0].lastMovedAt = new Date("2026-09-08T12:00:00.000Z");
      db.sessions[0].scheduledStartTime = new Date("2026-09-09T01:00:00.000Z");

      const outcome = await service.materialize(
        USER,
        [block({ scheduledStartTime: new Date("2026-09-11T03:00:00.000Z") })],
        "LMS",
      );

      expect(outcome).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
        guarded: 1,
      });
      // Their placement survived untouched.
      expect(db.sessions[0].scheduledStartTime).toEqual(
        new Date("2026-09-09T01:00:00.000Z"),
      );
      expect(db.notifications).toHaveLength(2);
      expect(db.notifications[1]).toMatchObject({
        topic: "TIMETABLE",
        sessionId: db.sessions[0].id,
      });
      expect(db.notifications[1].content).toContain("2026-09-11T03:00:00.000Z");
    });

    it("does not re-raise the same warning on every tick", async () => {
      const { db, service } = makeService();
      await service.materialize(USER, [block()], "LMS");
      db.sessions[0].lastMovedAt = new Date("2026-09-08T12:00:00.000Z");
      db.sessions[0].scheduledStartTime = new Date("2026-09-09T01:00:00.000Z");
      const upstream = [
        block({ scheduledStartTime: new Date("2026-09-11T03:00:00.000Z") }),
      ];

      await service.materialize(USER, upstream, "LMS");
      await service.materialize(USER, upstream, "LMS");
      await service.materialize(USER, upstream, "LMS");

      expect(db.notifications).toHaveLength(2);
    });

    it("does speak up when upstream moves again", async () => {
      const { db, service } = makeService();
      await service.materialize(USER, [block()], "LMS");
      db.sessions[0].lastMovedAt = new Date("2026-09-08T12:00:00.000Z");

      await service.materialize(
        USER,
        [block({ scheduledStartTime: new Date("2026-09-11T03:00:00.000Z") })],
        "LMS",
      );
      await service.materialize(
        USER,
        [block({ scheduledStartTime: new Date("2026-09-12T03:00:00.000Z") })],
        "LMS",
      );

      expect(db.notifications).toHaveLength(3);
      expect(db.notifications[2].content).toContain("2026-09-12T03:00:00.000Z");
    });
  });

  describe("timetable grouping", () => {
    const many = (n: number): ParsedBlock[] =>
      Array.from({ length: n }, (_, i) =>
        lecture({
          externalKey: `portal:meeting:7100${String(i).padStart(2, "0")}`,
          title: `Buổi học ${i + 1}`,
          scheduledStartTime: new Date(Date.UTC(2026, 8, 10 + i, 2, 0, 0)),
        }),
      );

    it("folds a whole term's lectures into one 'timetable is available' row", async () => {
      const { db, service } = makeService();

      const outcome = await service.materialize(
        USER,
        many(12),
        "PORTAL",
        IN_TERM,
      );

      expect(outcome.created).toBe(12);
      expect(db.sessions).toHaveLength(12);
      // One notification, not twelve.
      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0]).toMatchObject({
        topic: "TIMETABLE",
        kind: "NEW",
        title: "Timetable for semester 1 is available",
        // Points at the earliest meeting, for the calendar to land on.
        sessionId: db.sessions[0].id,
        // A group has no single event time.
        eventEndsAt: null,
      });
    });

    it("lists the class names for a small mid-term addition", async () => {
      const { db, service } = makeService();

      await service.materialize(
        USER,
        [
          lecture({ externalKey: "portal:meeting:72001", title: "Đại số" }),
          lecture({ externalKey: "portal:meeting:72002", title: "Giải tích" }),
        ],
        "PORTAL",
        IN_TERM,
      );

      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0].title).toBe("New lectures: Đại số, Giải tích");
      expect(db.notifications[0].topic).toBe("TIMETABLE");
    });

    it("announces the term only once across the run's many weekly batches", async () => {
      const { db, service } = makeService();

      // Week one crosses the threshold; later weeks must stay quiet.
      await service.materialize(USER, many(10), "PORTAL", IN_TERM);
      await service.materialize(
        USER,
        many(10).map((b, i) => ({
          ...b,
          externalKey: `portal:meeting:7300${i}`,
        })),
        "PORTAL",
        IN_TERM,
      );

      const grouped = db.notifications.filter(
        (n) => n.title === "Timetable for semester 1 is available",
      );
      expect(grouped).toHaveLength(1);
    });

    it("stays quiet on a re-run of the same batch", async () => {
      const { db, service } = makeService();
      const items = many(12);

      await service.materialize(USER, items, "PORTAL", IN_TERM);
      await service.materialize(USER, items, "PORTAL", IN_TERM);

      expect(db.notifications).toHaveLength(1);
    });

    it("still raises one notification per assignment (those are actionable)", async () => {
      const { db, service } = makeService();

      await service.materialize(
        USER,
        [
          block({ externalKey: "lms:assign:1" }),
          block({ externalKey: "lms:assign:2" }),
        ],
        "LMS",
        IN_TERM,
      );

      expect(db.notifications).toHaveLength(2);
      expect(db.notifications.every((n) => n.topic === "ASSIGNMENT")).toBe(
        true,
      );
      // A per-item row carries the session's fixed end instant for its badge.
      expect(db.notifications[0].kind).toBe("NEW");
      expect(db.notifications[0].eventEndsAt).toBeInstanceOf(Date);
    });
  });

  describe("upstream deletion", () => {
    it("retires an ingested session upstream no longer lists", async () => {
      const { db, service } = makeService();
      await service.materialize(
        USER,
        [
          lecture({ externalKey: "portal:meeting:80001", title: "Kept" }),
          lecture({ externalKey: "portal:meeting:80002", title: "Gone" }),
        ],
        "PORTAL",
        IN_TERM,
      );
      expect(db.sessions).toHaveLength(2);

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set(["portal:meeting:80001"]),
        IN_TERM,
      );

      expect(recon).toEqual({ deleted: 1, keptWithWarning: 0 });
      expect(db.sessions.map((s) => s.externalKey)).toEqual([
        "portal:meeting:80001",
      ]);
      const removal = db.notifications.at(-1)!;
      expect(removal.topic).toBe("TIMETABLE");
      expect(removal.kind).toBe("DROP");
      expect(removal.title).toContain("Gone");
      expect(removal.sessionId).toBeNull();
    });

    it("keeps — and warns about — a session the student had hand-moved", async () => {
      const { db, service } = makeService();
      await service.materialize(
        USER,
        [lecture({ externalKey: "portal:meeting:81001", title: "Mine now" })],
        "PORTAL",
        IN_TERM,
      );
      db.sessions[0].lastMovedAt = new Date("2026-09-07T00:00:00.000Z");

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon).toEqual({ deleted: 0, keptWithWarning: 1 });
      expect(db.sessions).toHaveLength(1);
      const warn = db.notifications.at(-1)!;
      expect(warn.title).toContain("removed at DLU");
      expect(warn.sessionId).toBe(db.sessions[0].id);
    });

    it("is a no-op on a settled re-run", async () => {
      const { db, service } = makeService();
      await service.materialize(
        USER,
        [lecture({ externalKey: "portal:meeting:82001" })],
        "PORTAL",
        IN_TERM,
      );

      await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );
      const before = db.notifications.length;
      const again = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(again).toEqual({ deleted: 0, keptWithWarning: 0 });
      expect(db.notifications).toHaveLength(before);
    });

    it("leaves sessions outside the run's forward window alone", async () => {
      const { db, service } = makeService();
      await service.materialize(
        USER,
        [
          lecture({
            externalKey: "portal:meeting:83001",
            // A month before `now` — behind the deletion horizon.
            scheduledStartTime: new Date("2026-08-01T02:00:00.000Z"),
          }),
        ],
        "PORTAL",
        IN_TERM,
      );

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon.deleted).toBe(0);
      expect(db.sessions).toHaveLength(1);
    });

    it("groups a bulk timetable removal", async () => {
      const { db, service } = makeService();
      const items = Array.from({ length: 11 }, (_, i) =>
        lecture({
          externalKey: `portal:meeting:8400${i}`,
          title: `Buổi ${i}`,
          scheduledStartTime: new Date(Date.UTC(2026, 8, 12 + i, 2, 0, 0)),
        }),
      );
      await service.materialize(USER, items, "PORTAL", IN_TERM);
      const before = db.notifications.length;

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon.deleted).toBe(11);
      expect(db.sessions).toHaveLength(0);
      expect(db.notifications).toHaveLength(before + 1);
      expect(db.notifications.at(-1)!.title).toBe(
        "Your semester 1 timetable changed",
      );
      expect(db.notifications.at(-1)!.content).toContain("11 classes");
    });
  });
});
