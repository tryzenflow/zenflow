import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { MaterializerService } from "./materializer.service";
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
  // Two-consecutive-run confirmation gate (see materializer.service.ts).
  syncConfirmedAt: Date | null;
  syncMissedAt: Date | null;
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
  topic: string;
  eventType: string;
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
          // A first sighting is never confirmed — see the confirm gate.
          syncConfirmedAt: null,
          syncMissedAt: null,
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
          topic: args.data.topic as string,
          eventType: args.data.eventType as string,
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

async function makeService() {
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
 * Materializes `items` twice with the same data — the first sighting (writes
 * the rows, unconfirmed, silent) and the second (confirms them and raises
 * their notifications) — so tests that exercise the *post*-confirmation
 * behaviour (upstream changes, hand-moves, removals) can start from a normal,
 * settled, confirmed state without re-deriving the confirm gate every time.
 */
async function seedConfirmed(
  service: MaterializerService,
  items: readonly ParsedBlock[],
  source: "LMS" | "PORTAL",
  now?: Date,
) {
  await service.materialize(USER, items, source, now);
  return service.materialize(USER, items, source, now);
}

describe("MaterializerService", () => {
  describe("create", () => {
    it("writes the session and its CREATE event on first sighting, but holds the notification back", async () => {
      const { db, service } = await makeService();

      const outcome = await service.materialize(USER, [block()], "LMS");

      expect(outcome).toEqual({
        created: 1,
        confirmed: 0,
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
        // Not confirmed yet — a single sighting proves nothing.
        syncConfirmedAt: null,
      });
      // Ingested rows join the same audit trail as user-pinned ones.
      expect(db.events).toHaveLength(1);
      expect(db.events[0]).toMatchObject({ eventType: "CREATE" });

      // A single-run blip must not notify.
      expect(db.notifications).toHaveLength(0);
    });

    it("confirms and raises the notification on the second sighting", async () => {
      const { db, service } = await makeService();
      await service.materialize(USER, [block()], "LMS");

      const outcome = await service.materialize(USER, [block()], "LMS");

      expect(outcome).toEqual({
        created: 0,
        confirmed: 1,
        updated: 0,
        unchanged: 0,
        skippedDeleted: 0,
        skippedMoved: 0,
      });
      expect(db.sessions[0].syncConfirmedAt).toBeInstanceOf(Date);
      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0]).toMatchObject({
        topic: "ASSIGNMENT",
        eventType: "CREATED",
        eventName: "assignment.created",
        sessionId: db.sessions[0].id,
      });
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

    it("maps EXAM and LECTURE onto their notification topics once confirmed", async () => {
      const { db, service } = await makeService();
      const items = [
        block({ externalKey: "portal:exam:500001", type: "EXAM" }),
        block({ externalKey: "portal:meeting:600001", type: "LECTURE" }),
      ];

      await seedConfirmed(service, items, "PORTAL");

      expect(db.notifications.map((n) => n.topic)).toEqual([
        "EXAM",
        "TIMETABLE",
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
        syncConfirmedAt: null,
        syncMissedAt: null,
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

  describe("confirm gate — a single-run blip must not notify or delete", () => {
    it("hard-deletes a still-pending item that vanishes before ever being confirmed, no notification", async () => {
      const { db, service } = await makeService();
      await service.materialize(
        USER,
        [lecture({ externalKey: "portal:meeting:90001" })],
        "PORTAL",
        IN_TERM,
      );
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].syncConfirmedAt).toBeNull();

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon).toEqual({
        deleted: 0,
        keptMoved: 0,
        missedOnce: 0,
        hardDeletedUnconfirmed: 1,
      });
      // Hard-deleted, not soft-deleted — it was never a real, user-facing item.
      expect(db.sessions).toHaveLength(0);
      expect(db.notifications).toHaveLength(0);
    });

    it("a first miss on a confirmed item leaves it exactly as-is: no delete, no notification", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(
        service,
        [lecture({ externalKey: "portal:meeting:90002" })],
        "PORTAL",
        IN_TERM,
      );
      const notificationsBefore = db.notifications.length;

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon).toEqual({
        deleted: 0,
        keptMoved: 0,
        missedOnce: 1,
        hardDeletedUnconfirmed: 0,
      });
      expect(db.sessions[0].deleted).toBe(false);
      expect(db.sessions[0].syncMissedAt).toBeInstanceOf(Date);
      expect(db.notifications).toHaveLength(notificationsBefore);
    });

    it("a second consecutive miss soft-deletes and notifies (today's removal behaviour, delayed by one run)", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(
        service,
        [lecture({ externalKey: "portal:meeting:90003", title: "Gone soon" })],
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

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon).toEqual({
        deleted: 1,
        keptMoved: 0,
        missedOnce: 0,
        hardDeletedUnconfirmed: 0,
      });
      expect(db.sessions[0].deleted).toBe(true);
      const removal = db.notifications.at(-1)!;
      expect(removal.eventType).toBe("REMOVED");
      expect(removal.title).toContain("Gone soon");
    });

    it("clears the miss streak the moment a confirmed item reappears, regardless of anything else changing", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(service, [block()], "LMS");
      // Simulate one prior miss (as `reconcileDeleted` would have stamped it)
      // and resend the same item on `materialize()` — the streak must reset.
      db.sessions[0].syncMissedAt = new Date("2026-09-09T00:00:00.000Z");

      const outcome = await service.materialize(USER, [block()], "LMS");

      expect(outcome.unchanged).toBe(1);
      expect(db.sessions[0].syncMissedAt).toBeNull();
    });

    it("resets a miss streak even when the reappearing item also changed", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(service, [block()], "LMS");
      db.sessions[0].syncMissedAt = new Date("2026-09-09T00:00:00.000Z");
      const notificationsBefore = db.notifications.length;

      const outcome = await service.materialize(
        USER,
        [block({ title: "Renamed after reappearing" })],
        "LMS",
      );

      expect(outcome.updated).toBe(1);
      expect(db.sessions[0].syncMissedAt).toBeNull();
      expect(db.sessions[0].title).toBe("Renamed after reappearing");
      expect(db.notifications).toHaveLength(notificationsBefore + 1);
    });
  });

  describe("idempotency", () => {
    it("confirms on the second run, then stays quiet from the third run on", async () => {
      const { db, service } = await makeService();
      const items = [block()];

      const first = await service.materialize(USER, items, "LMS");
      const second = await service.materialize(USER, items, "LMS");
      const third = await service.materialize(USER, items, "LMS");

      expect(first).toMatchObject({ created: 1, confirmed: 0 });
      expect(second).toMatchObject({ created: 0, confirmed: 1 });
      expect(third).toEqual({
        created: 0,
        confirmed: 0,
        updated: 0,
        unchanged: 1,
        skippedDeleted: 0,
        skippedMoved: 0,
      });
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
    it("follows a move on a confirmed session the student has never touched", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(service, [block()], "LMS");

      const moved = block({
        scheduledStartTime: new Date("2026-09-11T03:00:00.000Z"),
      });
      const outcome = await service.materialize(USER, [moved], "LMS");

      expect(outcome.updated).toBe(1);
      expect(db.sessions[0].scheduledStartTime).toEqual(
        new Date("2026-09-11T03:00:00.000Z"),
      );
      // One CREATED notification from confirmation, one UPDATED from the move.
      expect(db.notifications).toHaveLength(2);
      expect(db.notifications[1].title).toContain("Updated:");
      expect(db.notifications[1]).toMatchObject({
        eventType: "UPDATED",
        eventName: "assignment.updated",
      });
      // Not a user action, so it must not enter the ML event trail...
      expect(db.events).toHaveLength(1);
      // ...nor claim the student moved it.
      expect(db.sessions[0].lastMovedAt).toBeNull();
    });

    it("settles down: the run after an upstream change is unchanged again", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(service, [block()], "LMS");
      const moved = block({
        scheduledStartTime: new Date("2026-09-11T03:00:00.000Z"),
      });
      await service.materialize(USER, [moved], "LMS");

      const settled = await service.materialize(USER, [moved], "LMS");

      expect(settled.unchanged).toBe(1);
      expect(db.notifications).toHaveLength(2);
    });

    it("notices a title-only change on a confirmed session", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(service, [block()], "LMS");

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
    it("applies an upstream change to a confirmed session the student never touched, with a normal UPDATED notification", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(service, [block()], "LMS");

      const outcome = await service.materialize(
        USER,
        [block({ scheduledStartTime: new Date("2026-09-11T03:00:00.000Z") })],
        "LMS",
      );

      expect(outcome).toEqual({
        created: 0,
        confirmed: 0,
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
        topic: "ASSIGNMENT",
        eventType: "UPDATED",
        sessionId: db.sessions[0].id,
      });
      expect(db.notifications[1].title).toContain("Updated:");
    });

    it("silently keeps a hand-moved confirmed session's position — no reversion, no notification", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(service, [block()], "LMS");
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
        confirmed: 0,
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

    it("soft-deletes a confirmed session upstream removes on the second consecutive miss, with a normal REMOVED notification", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(
        service,
        [lecture({ externalKey: "portal:meeting:81001", title: "Gone now" })],
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
      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon).toEqual({
        deleted: 1,
        keptMoved: 0,
        missedOnce: 0,
        hardDeletedUnconfirmed: 0,
      });
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].deleted).toBe(true);
      const drop = db.notifications.at(-1)!;
      expect(drop.sessionId).toBeNull();
      expect(drop.eventType).toBe("REMOVED");
      expect(drop.title).toContain("Gone now");
    });

    it("silently keeps a hand-moved confirmed session upstream removes — no deletion, no notification", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(
        service,
        [lecture({ externalKey: "portal:meeting:81001", title: "Mine now" })],
        "PORTAL",
        IN_TERM,
      );
      db.sessions[0].lastMovedAt = new Date("2026-09-07T00:00:00.000Z");
      const notificationsBefore = db.notifications.length;

      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );

      expect(recon).toEqual({
        deleted: 0,
        keptMoved: 1,
        missedOnce: 0,
        hardDeletedUnconfirmed: 0,
      });
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].deleted).toBe(false);
      expect(db.notifications).toHaveLength(notificationsBefore);
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

    it("folds a whole term's lectures into one 'timetable is available' row, once confirmed", async () => {
      const { db, service } = await makeService();
      const items = many(12);

      const first = await service.materialize(USER, items, "PORTAL", IN_TERM);
      expect(first.created).toBe(12);
      expect(db.notifications).toHaveLength(0);

      const second = await service.materialize(USER, items, "PORTAL", IN_TERM);

      expect(second.confirmed).toBe(12);
      expect(db.sessions).toHaveLength(12);
      // One notification, not twelve.
      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0]).toMatchObject({
        topic: "TIMETABLE",
        eventType: "CREATED",
        eventName: "timetable.group_created",
        title: "Timetable for semester 1 is available",
        // Points at the earliest meeting, for the calendar to land on.
        sessionId: db.sessions[0].id,
        // A group has no single event time.
        eventEndsAt: null,
      });
    });

    it("lists the class names for a small mid-term addition, once confirmed", async () => {
      const { db, service } = await makeService();
      const items = [
        lecture({ externalKey: "portal:meeting:72001", title: "Đại số" }),
        lecture({ externalKey: "portal:meeting:72002", title: "Giải tích" }),
      ];

      await seedConfirmed(service, items, "PORTAL", IN_TERM);

      expect(db.notifications).toHaveLength(1);
      expect(db.notifications[0].title).toBe("New lectures: Đại số, Giải tích");
      expect(db.notifications[0].topic).toBe("TIMETABLE");
      expect(db.notifications[0].eventName).toBe("lecture.created");
    });

    it("announces the term only once, even though confirmation itself takes two runs", async () => {
      const { db, service } = await makeService();
      const items = many(10);

      await service.materialize(USER, items, "PORTAL", IN_TERM); // first sighting, silent
      await service.materialize(USER, items, "PORTAL", IN_TERM); // confirms, crosses threshold, notifies
      await service.materialize(USER, items, "PORTAL", IN_TERM); // settled, quiet

      const grouped = db.notifications.filter(
        (n) => n.title === "Timetable for semester 1 is available",
      );
      expect(grouped).toHaveLength(1);
    });

    it("raises the grouped notification once, then stays quiet on further re-runs", async () => {
      const { db, service } = await makeService();
      const items = many(12);

      await service.materialize(USER, items, "PORTAL", IN_TERM);
      await service.materialize(USER, items, "PORTAL", IN_TERM);
      await service.materialize(USER, items, "PORTAL", IN_TERM);

      expect(db.notifications).toHaveLength(1);
    });

    it("still raises one notification per assignment (those are actionable), once confirmed", async () => {
      const { db, service } = await makeService();
      const items = [
        block({ externalKey: "lms:assign:1" }),
        block({ externalKey: "lms:assign:2" }),
      ];

      await seedConfirmed(service, items, "LMS", IN_TERM);

      expect(db.notifications).toHaveLength(2);
      expect(db.notifications.every((n) => n.topic === "ASSIGNMENT")).toBe(
        true,
      );
      // A per-item row carries the session's fixed end instant for its badge.
      expect(db.notifications[0].eventEndsAt).toBeInstanceOf(Date);
    });
  });

  describe("upstream deletion", () => {
    it("soft-deletes a confirmed ingested session upstream no longer lists, on the second consecutive miss", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(
        service,
        [
          lecture({ externalKey: "portal:meeting:80001", title: "Kept" }),
          lecture({ externalKey: "portal:meeting:80002", title: "Gone" }),
        ],
        "PORTAL",
        IN_TERM,
      );
      expect(db.sessions).toHaveLength(2);

      // First miss: stamped, left alone, no notification.
      const firstMiss = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set(["portal:meeting:80001"]),
        IN_TERM,
      );
      expect(firstMiss).toEqual({
        deleted: 0,
        keptMoved: 0,
        missedOnce: 1,
        hardDeletedUnconfirmed: 0,
      });

      // Second consecutive miss: today's removal behaviour.
      const recon = await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set(["portal:meeting:80001"]),
        IN_TERM,
      );

      expect(recon).toEqual({
        deleted: 1,
        keptMoved: 0,
        missedOnce: 0,
        hardDeletedUnconfirmed: 0,
      });
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
      expect(removal.topic).toBe("TIMETABLE");
      expect(removal.eventType).toBe("REMOVED");
      expect(removal.title).toContain("Gone");
      expect(removal.sessionId).toBeNull();
    });

    it("is a no-op on a settled re-run", async () => {
      const { db, service } = await makeService();
      await seedConfirmed(
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

      expect(again).toEqual({
        deleted: 0,
        keptMoved: 0,
        missedOnce: 0,
        hardDeletedUnconfirmed: 0,
      });
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

    it("groups a bulk timetable removal on the second consecutive miss", async () => {
      const { db, service } = await makeService();
      const items = Array.from({ length: 11 }, (_, i) =>
        lecture({
          externalKey: `portal:meeting:8400${i}`,
          title: `Buổi ${i}`,
          scheduledStartTime: new Date(Date.UTC(2026, 8, 12 + i, 2, 0, 0)),
        }),
      );
      await seedConfirmed(service, items, "PORTAL", IN_TERM);
      const before = db.notifications.length;

      await service.reconcileDeleted(
        USER,
        "PORTAL",
        ["LECTURE"],
        new Set<string>(),
        IN_TERM,
      );
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
      expect(db.notifications.at(-1)!.title).toBe(
        "Your semester 1 timetable changed",
      );
      expect(db.notifications.at(-1)!.eventType).toBe("REMOVED");
      expect(db.notifications.at(-1)!.content).toContain("11 classes");
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
        confirmed: 0,
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
