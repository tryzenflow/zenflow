import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { SyncDigest } from "./core/sync-digest";
import { MaterializerService } from "./materializer.service";
import { SyncConflictsService } from "./sync-conflicts.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TagsService } from "../tags/tags.service";
import type {
  ParsedBlock,
  ParsedLmsItem,
  ParsedPortalItem,
} from "./core/types";

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
  deleted: boolean;
  scheduleStudyUnitId: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: { name: string }[];
  series: null;
}

interface NotificationRow {
  id: string;
  userId: string;
  sessionId: string | null;
  eventName: string;
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
  const reminders: { sessionId: string; remindBeforeMinutes: number }[] = [];
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
          deleted: false,
          scheduleStudyUnitId:
            (data.scheduleStudyUnitId as string | null) ?? null,
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
          eventName: args.data.eventName as string,
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
    sessionReminder: {
      create: (args: {
        data: { sessionId: string; remindBeforeMinutes: number };
      }) => {
        reminders.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(client),
  };

  return { client, sessions, notifications, events, tags, reminders };
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

async function makeService(
  syncConflicts?: Pick<SyncConflictsService, "detectAndNotify">,
) {
  const db = makePrismaDouble();
  const prisma = db.client as unknown as PrismaService;
  const config = {
    get: (name: string) => (name === "DLU_TZ" ? "Asia/Ho_Chi_Minh" : undefined),
  } as unknown as ConfigService;

  // TagsService and NotificationsService are the real classes, wired via
  // Nest's DI container over the fake prisma double — their `create` writes
  // go through the same `notification`/`tag` tables the assertions read.
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MaterializerService,
      TagsService,
      NotificationsService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: config },
      ...(syncConflicts
        ? [{ provide: SyncConflictsService, useValue: syncConflicts }]
        : []),
    ],
  }).compile();
  const service = module.get<MaterializerService>(MaterializerService);
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

/**
 * One materialize run — enough to put an item on the calendar.
 */
async function seedExisting(
  service: MaterializerService,
  items: readonly ParsedBlock[],
  source: "LMS" | "PORTAL",
  now?: Date,
) {
  return service.materialize(USER, items, source, now);
}

describe("MaterializerService", () => {
  describe("create", () => {
    it("writes the session, its CREATE event, and the notification on first sighting", async () => {
      const { db, service } = await makeService();

      const outcome = await service.materialize(USER, [block()], "LMS");

      expect(outcome).toEqual({
        created: 1,
        updated: 0,
        unchanged: 0,
        skippedDeleted: 0,
        skippedMoved: 0,
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
        eventName: "assignment.group_created",
        sessionId: db.sessions[0].id,
      });
    });

    it("a second identical sighting is a silent no-op", async () => {
      const { db, service } = await makeService();
      await service.materialize(USER, [block()], "LMS");

      const outcome = await service.materialize(USER, [block()], "LMS");

      expect(outcome).toEqual({
        created: 0,
        updated: 0,
        unchanged: 1,
        skippedDeleted: 0,
        skippedMoved: 0,
      });
      // Still just the one notification from the first sighting.
      expect(db.notifications).toHaveLength(1);
    });

    it("tags the session with the LMS course's full name", async () => {
      const { db, service } = await makeService();

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
      const { db, service } = await makeService();

      const lmsItem: ParsedLmsItem = {
        ...block({ externalKey: "lms:assign:800010" }),
        lmsCourse: null,
      };

      await service.materialize(USER, [lmsItem], "LMS");

      expect(db.sessions[0].tags).toEqual([]);
      expect(db.tags).toHaveLength(0);
    });

    it("writes the room to the location column and leaves the note untouched", async () => {
      const { db, service } = await makeService();

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

    it("maps EXAM and LECTURE onto their notification event categories", async () => {
      const { db, service } = await makeService();
      const items = [
        block({ externalKey: "portal:exam:500001", type: "EXAM" }),
        block({ externalKey: "portal:meeting:600001", type: "LECTURE" }),
      ];

      await service.materialize(USER, items, "PORTAL");

      expect(db.notifications.map((n) => n.eventName)).toEqual([
        "exam.group_created",
        "lecture.group_created",
      ]);
    });

    it("persists a portal-ingested lecture's scheduleStudyUnitId (the grouping key for bulk delete)", async () => {
      const { db, service } = await makeService();

      const portalItem: ParsedPortalItem = {
        ...block({
          externalKey: "portal:meeting:600002",
          type: "LECTURE",
          location: "X01.01",
        }),
        scheduleStudyUnitId: "99910AB100101",
      };

      await service.materialize(USER, [portalItem], "PORTAL");

      expect(db.sessions[0]).toMatchObject({
        type: "LECTURE",
        scheduleStudyUnitId: "99910AB100101",
      });
    });

    it("leaves scheduleStudyUnitId null for an LMS item (no portal section)", async () => {
      const { db, service } = await makeService();

      await service.materialize(USER, [block()], "LMS");

      expect(db.sessions[0].scheduleStudyUnitId).toBeNull();
    });

    it("treats a P2002 race as a no-op rather than an error", async () => {
      const { db, service } = await makeService();
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
        deleted: false,
        scheduleStudyUnitId: null,
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
    it("notifies on the first run, then stays quiet from the second run on", async () => {
      const { db, service } = await makeService();
      const items = [block()];

      const first = await service.materialize(USER, items, "LMS");
      const second = await service.materialize(USER, items, "LMS");
      const third = await service.materialize(USER, items, "LMS");

      expect(first).toMatchObject({ created: 1, unchanged: 0 });
      expect(second).toEqual({
        created: 0,
        updated: 0,
        unchanged: 1,
        skippedDeleted: 0,
        skippedMoved: 0,
      });
      expect(third).toEqual(second);
      expect(db.sessions).toHaveLength(1);
      expect(db.notifications).toHaveLength(1);
      expect(db.events).toHaveLength(1);
      expect(db.reminders).toHaveLength(1);
    });
  });

  describe("default reminder", () => {
    it("gives every newly ingested item a 1-hour reminder", async () => {
      const { db, service } = await makeService();
      await service.materialize(
        USER,
        [
          block(),
          block({ externalKey: "portal:exam:1", type: "EXAM" }),
          block({ externalKey: "portal:tt:1", type: "LECTURE" }),
        ],
        "LMS",
      );
      expect(db.reminders).toHaveLength(3);
      expect(db.reminders.every((r) => r.remindBeforeMinutes === 60)).toBe(
        true,
      );
    });
  });

  describe("upstream change", () => {
    it("follows a move on a session the student has never touched", async () => {
      const { db, service } = await makeService();
      await seedExisting(service, [block()], "LMS");

      const moved = block({
        scheduledStartTime: new Date("2026-09-11T03:00:00.000Z"),
      });
      const outcome = await service.materialize(USER, [moved], "LMS");

      expect(outcome.updated).toBe(1);
      expect(db.sessions[0].scheduledStartTime).toEqual(
        new Date("2026-09-11T03:00:00.000Z"),
      );
      // One CREATED notification from the first sighting, one UPDATED from the move.
      expect(db.notifications).toHaveLength(2);
      expect(db.notifications[1].title).toBe(
        "You have a change to your assignments",
      );
      expect(db.notifications[1]).toMatchObject({
        eventName: "assignment.group_updated",
      });
      // Not a user action, so it must not enter the ML event trail...
      expect(db.events).toHaveLength(1);
      // ...nor claim the student moved it.
      expect(db.sessions[0].lastMovedAt).toBeNull();
    });

    it("settles down: the run after an upstream change is unchanged again", async () => {
      const { db, service } = await makeService();
      await seedExisting(service, [block()], "LMS");
      const moved = block({
        scheduledStartTime: new Date("2026-09-11T03:00:00.000Z"),
      });
      await service.materialize(USER, [moved], "LMS");

      const settled = await service.materialize(USER, [moved], "LMS");

      expect(settled.unchanged).toBe(1);
      expect(db.notifications).toHaveLength(2);
    });

    it("notices a title-only change", async () => {
      const { db, service } = await makeService();
      await seedExisting(service, [block()], "LMS");

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

  describe("plain sync — upstream wins, unless the student already moved it", () => {
    it("applies an upstream change the student never touched, with a normal UPDATED notification", async () => {
      const { db, service } = await makeService();
      await seedExisting(service, [block()], "LMS");

      const outcome = await service.materialize(
        USER,
        [block({ scheduledStartTime: new Date("2026-09-11T03:00:00.000Z") })],
        "LMS",
      );

      expect(outcome).toEqual({
        created: 0,
        updated: 1,
        unchanged: 0,
        skippedDeleted: 0,
        skippedMoved: 0,
      });
      expect(db.sessions[0].scheduledStartTime).toEqual(
        new Date("2026-09-11T03:00:00.000Z"),
      );
      expect(db.notifications).toHaveLength(2);
      expect(db.notifications[1]).toMatchObject({
        eventName: "assignment.group_updated",
        sessionId: db.sessions[0].id,
      });
      expect(db.notifications[1].title).toBe(
        "You have a change to your assignments",
      );
    });

    it("silently keeps a hand-moved session's position — no reversion, no notification", async () => {
      const { db, service } = await makeService();
      await seedExisting(service, [block()], "LMS");
      // The student dragged it, so the row carries their fingerprint.
      db.sessions[0].lastMovedAt = new Date("2026-09-08T12:00:00.000Z");
      db.sessions[0].scheduledStartTime = new Date("2026-09-09T01:00:00.000Z");
      const notificationsBefore = db.notifications.length;

      const outcome = await service.materialize(
        USER,
        [block({ scheduledStartTime: new Date("2026-09-11T03:00:00.000Z") })],
        "LMS",
      );

      expect(outcome).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedDeleted: 0,
        skippedMoved: 1,
      });
      // The student's move wins — upstream's position never applies.
      expect(db.sessions[0].scheduledStartTime).toEqual(
        new Date("2026-09-09T01:00:00.000Z"),
      );
      expect(db.notifications).toHaveLength(notificationsBefore);
    });

    it("soft-deletes a session upstream removes, immediately, with a normal REMOVED notification", async () => {
      const { db, service } = await makeService();
      await seedExisting(
        service,
        [lecture({ externalKey: "portal:meeting:81001", title: "Gone now" })],
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

      expect(recon).toEqual({ deleted: 1 });
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].deleted).toBe(true);
      const drop = db.notifications.at(-1)!;
      expect(drop.sessionId).toBeNull();
      expect(drop.title).toBe("You have a lecture removed");
    });

    it("removes a hand-moved session upstream drops too — the move only protects position, not existence", async () => {
      const { db, service } = await makeService();
      await seedExisting(
        service,
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

      expect(recon).toEqual({ deleted: 1 });
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].deleted).toBe(true);
      const drop = db.notifications.at(-1)!;
      expect(drop.title).toBe("You have a lecture removed");
    });
  });

  describe("run digest — one notification per item type per run", () => {
    const many = (n: number): ParsedBlock[] =>
      Array.from({ length: n }, (_, i) =>
        lecture({
          externalKey: `portal:meeting:7100${String(i).padStart(2, "0")}`,
          title: `Buổi học ${i + 1}`,
          scheduledStartTime: new Date(Date.UTC(2026, 8, 10 + i, 2, 0, 0)),
        }),
      );

    it("folds a whole term's lectures into one grouped row, then stays quiet", async () => {
      const { db, service } = await makeService();
      const items = many(12);

      const first = await service.materialize(USER, items, "PORTAL", IN_TERM);
      expect(first.created).toBe(12);
      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0]).toMatchObject({
        eventName: "lecture.group_created",
        title: "You have 12 new lectures",
        // The soonest upcoming meeting, for the calendar to land on.
        sessionId: db.sessions[0].id,
        // A group has no single event time.
        eventEndsAt: null,
      });

      const second = await service.materialize(USER, items, "PORTAL", IN_TERM);
      expect(second.unchanged).toBe(12);
      expect(db.notifications).toHaveLength(1);
    });

    it("groups regardless of size — two lectures are one row", async () => {
      const { db, service } = await makeService();
      await service.materialize(USER, many(2), "PORTAL", IN_TERM);

      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0].title).toBe("You have 2 new lectures");
    });

    it('still groups a single change: "You have a new lecture"', async () => {
      const { db, service } = await makeService();
      await service.materialize(
        USER,
        [lecture({ externalKey: "portal:meeting:72001", title: "Đại số" })],
        "PORTAL",
        IN_TERM,
      );

      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0]).toMatchObject({
        title: "You have a new lecture",
        eventName: "lecture.group_created",
      });
      // A per-item row carries the session's fixed end instant for its badge.
      expect(db.notifications[0].eventEndsAt).toBeInstanceOf(Date);
    });

    it("groups assignments too, one row per type", async () => {
      const { db, service } = await makeService();
      await service.materialize(
        USER,
        [
          block({ externalKey: "lms:assign:1" }),
          block({ externalKey: "lms:assign:2" }),
          block({ externalKey: "lms:exam:3", type: "EXAM" }),
        ],
        "LMS",
        IN_TERM,
      );

      expect(db.notifications.map((n) => n.eventName)).toEqual([
        "exam.group_created",
        "assignment.group_created",
      ]);
      expect(db.notifications[1].title).toBe("You have 2 new assignments");
    });

    it("spans every call that shares a digest, removals included, until flushed", async () => {
      const { db, service } = await makeService();
      const old = lecture({ externalKey: "portal:meeting:73000" });
      await seedExisting(service, [old], "PORTAL", IN_TERM);
      const before = db.notifications.length;
      const fresh = many(2);

      const digest = new SyncDigest(IN_TERM);
      await service.materialize(USER, fresh, "PORTAL", IN_TERM, digest);
      await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set(fresh.map((f) => f.externalKey)),
        IN_TERM,
        digest,
      );
      // Nothing raised mid-run.
      expect(db.notifications).toHaveLength(before);

      await service.flushDigest(USER, digest, IN_TERM);

      expect(db.notifications).toHaveLength(before + 1);
      expect(db.notifications.at(-1)).toMatchObject({
        title: "You have 2 new lectures, 1 lecture removed",
        eventName: "lecture.group_created",
      });
    });
  });

  describe("sync conflicts", () => {
    it("checks once per (source, type) at the end of the run, not per fetch", async () => {
      const detectAndNotify = jest.fn().mockResolvedValue(0);
      const { service } = await makeService({ detectAndNotify });
      const digest = new SyncDigest(IN_TERM);

      // Two weekly fetches of the same run.
      await service.materialize(
        USER,
        [lecture({ externalKey: "portal:meeting:74001" })],
        "PORTAL",
        IN_TERM,
        digest,
      );
      await service.materialize(
        USER,
        [lecture({ externalKey: "portal:meeting:74002" })],
        "PORTAL",
        IN_TERM,
        digest,
      );
      expect(detectAndNotify).not.toHaveBeenCalled();

      await service.flushDigest(USER, digest, IN_TERM);

      expect(detectAndNotify).toHaveBeenCalledTimes(1);
      expect(detectAndNotify).toHaveBeenCalledWith({
        userId: USER,
        source: "PORTAL",
        type: "LECTURE",
        // Everything written since the run began counts as just synced.
        since: IN_TERM,
      });
    });

    it("skips the check when the run wrote nothing", async () => {
      const detectAndNotify = jest.fn().mockResolvedValue(0);
      const { service } = await makeService({ detectAndNotify });
      const items = [lecture({ externalKey: "portal:meeting:74003" })];
      await service.materialize(USER, items, "PORTAL", IN_TERM);
      detectAndNotify.mockClear();

      // A quiet re-run: unchanged, nothing written, nothing to re-check.
      await service.materialize(USER, items, "PORTAL", IN_TERM);

      expect(detectAndNotify).not.toHaveBeenCalled();
    });
  });

  describe("upstream deletion", () => {
    it("soft-deletes a session upstream no longer lists, immediately, keeping the still-seen one", async () => {
      const { db, service } = await makeService();
      await seedExisting(
        service,
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

      expect(recon).toEqual({ deleted: 1 });
      // The row survives (soft-deleted), not hard-removed, so a future
      // re-fetch that lists this externalKey again is recognized and skipped.
      expect(db.sessions).toHaveLength(2);
      const gone = db.sessions.find(
        (s) => s.externalKey === "portal:meeting:80002",
      )!;
      expect(gone.deleted).toBe(true);
      const kept = db.sessions.find(
        (s) => s.externalKey === "portal:meeting:80001",
      )!;
      expect(kept.deleted).toBe(false);
      const removal = db.notifications.at(-1)!;
      expect(removal.eventName).toBe("lecture.group_removed");
      expect(removal.title).toBe("You have a lecture removed");
      expect(removal.sessionId).toBeNull();
    });

    it("is a no-op once the item is already (soft-)deleted", async () => {
      const { db, service } = await makeService();
      await seedExisting(
        service,
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

      expect(again).toEqual({ deleted: 0 });
      expect(db.notifications).toHaveLength(before);
    });

    it("leaves sessions outside the run's forward window alone", async () => {
      const { db, service } = await makeService();
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

    it("groups a bulk timetable removal into one notification", async () => {
      const { db, service } = await makeService();
      const items = Array.from({ length: 11 }, (_, i) =>
        lecture({
          externalKey: `portal:meeting:8400${i}`,
          title: `Buổi ${i}`,
          scheduledStartTime: new Date(Date.UTC(2026, 8, 12 + i, 2, 0, 0)),
        }),
      );
      await seedExisting(service, items, "PORTAL", IN_TERM);
      const before = db.notifications.length;

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon.deleted).toBe(11);
      expect(db.sessions).toHaveLength(11);
      expect(db.sessions.every((s) => s.deleted)).toBe(true);
      expect(db.notifications).toHaveLength(before + 1);
      expect(db.notifications.at(-1)).toMatchObject({
        title: "You have 11 lectures removed",
        eventName: "lecture.group_removed",
        // The sessions are gone — nothing to open.
        sessionId: null,
      });
    });
  });

  describe("student-deleted rows", () => {
    it("does not recreate a soft-deleted session on re-ingest", async () => {
      const { db, service } = await makeService();
      await service.materialize(USER, [block()], "LMS");
      db.sessions[0].deleted = true;
      const notificationsBefore = db.notifications.length;

      const outcome = await service.materialize(USER, [block()], "LMS");

      expect(outcome).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedDeleted: 1,
        skippedMoved: 0,
      });
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].deleted).toBe(true);
      // No new notification for something the student explicitly removed.
      expect(db.notifications).toHaveLength(notificationsBefore);
    });

    it("still skips a soft-deleted session even when upstream also changed it", async () => {
      const { db, service } = await makeService();
      await service.materialize(USER, [block()], "LMS");
      db.sessions[0].deleted = true;

      const outcome = await service.materialize(
        USER,
        [block({ title: "Renamed upstream" })],
        "LMS",
      );

      expect(outcome.skippedDeleted).toBe(1);
      expect(db.sessions[0].title).not.toBe("Renamed upstream");
    });
  });
});
