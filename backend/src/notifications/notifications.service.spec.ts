import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type Notification, type User } from "../../generated/prisma";
import { QueueService } from "../queue/queue.service";
import { NotificationPubSub } from "./notification-pubsub.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "./notifications.service";

// ── in-memory Prisma double ────────────────────────────────────────────────

interface Row {
  id: string;
  userId: string;
  sessionId: string | null;
  eventName: string;
  title: string;
  content: string;
  sentAt: Date;
  readAt: Date | null;
  actionTakenAt: Date | null;
  eventEndsAt: Date | null;
}

function makePrismaDouble(rows: Row[]) {
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const value = (r as unknown as Record<string, unknown>)[k];
      return v === null ? value === null : value === v;
    });

  const sessions: Record<string, unknown>[] = [];

  const client = {
    notification: {
      create: (args: { data: Record<string, unknown> }) => {
        const created = {
          id: `gen-${rows.length + 1}`,
          sentAt: new Date("2026-09-01T00:00:00.000Z"),
          readAt: null,
          actionTakenAt: null,
          ...args.data,
        } as Row;
        rows.push(created);
        return Promise.resolve(created);
      },
      findMany: (args: {
        where: Record<string, unknown>;
        take: number;
        skip: number;
      }) => {
        const found = rows
          .filter((r) => matches(r, args.where))
          // Newest first — what the orderBy asks Postgres for.
          .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
        return Promise.resolve(found.slice(args.skip, args.skip + args.take));
      },
      count: (args: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.filter((r) => matches(r, args.where)).length),
      findFirst: (args: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.find((r) => matches(r, args.where)) ?? null),
      update: (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((r) => matches(r, args.where));
        if (!row) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError("not found", {
              code: "P2025",
              clientVersion: "6",
            }),
          );
        }
        Object.assign(row, args.data);
        return Promise.resolve(row);
      },
      delete: (args: { where: Record<string, unknown> }) => {
        const i = rows.findIndex((r) => matches(r, args.where));
        if (i === -1) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError("not found", {
              code: "P2025",
              clientVersion: "6",
            }),
          );
        }
        return Promise.resolve(rows.splice(i, 1)[0]);
      },
    },
    session: {
      create: (args: { data: Record<string, unknown> }) => {
        const created = {
          id: `sess-${sessions.length + 1}`,
          ...args.data,
        };
        sessions.push(created);
        return Promise.resolve(created);
      },
    },
  };

  return { client, rows, sessions };
}

// ── fixtures ──────────────────────────────────────────────────────────────

const USER = { id: "u1" } as User;

function row(over: Partial<Row> & { id: string }): Row {
  return {
    userId: "u1",
    sessionId: "s1",
    eventName: "assignment.created",
    title: "New assignment: Môn học Mẫu Một",
    content: "Added to your calendar from DLU.",
    sentAt: new Date("2026-09-01T00:00:00.000Z"),
    readAt: null,
    actionTakenAt: null,
    eventEndsAt: null,
    ...over,
  };
}

async function makeService(rows: Row[]) {
  const db = makePrismaDouble(rows);
  const queue = {
    enqueueBestEffort: jest.fn().mockResolvedValue({ id: "job" }),
    getJob: jest.fn().mockResolvedValue(undefined),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      NotificationsService,
      NotificationPubSub,
      { provide: ConfigService, useValue: new ConfigService({}) },
      { provide: PrismaService, useValue: db.client },
      { provide: QueueService, useValue: queue },
    ],
  }).compile();
  return {
    db,
    queue,
    service: module.get<NotificationsService>(NotificationsService),
  };
}

describe("NotificationsService", () => {
  describe("notify", () => {
    const ROW = { id: "n1", userId: "u1" } as unknown as Notification;

    it("emits to the local SSE emitter (no pub/sub Redis configured)", async () => {
      const { service } = await makeService([]);
      const seen = jest.fn();
      service.notificationEmitter.on("session.new", seen);
      service.notify("session.new", ROW);
      expect(seen).toHaveBeenCalledWith(ROW);
    });

    it("enqueues one idempotent push job per provider", async () => {
      const { service, queue } = await makeService([]);
      service.notify("session.new", ROW);
      service.notify("session.new", ROW);
      const calls = queue.enqueueBestEffort.mock.calls as [
        unknown,
        { type: string; notificationId: string; provider: string },
        { jobId: string },
      ][];
      expect(calls.map((c) => c[2].jobId)).toEqual([
        "push_n1_fcm",
        "push_n1_apns",
        "push_n1_fcm",
        "push_n1_apns",
      ]);
      expect(calls[0][1]).toEqual({
        type: "push",
        notificationId: "n1",
        provider: "fcm",
      });
    });
    it("retries a failed enqueue, then counts it dropped without throwing", async () => {
      jest.useFakeTimers();
      try {
        const { service, queue } = await makeService([]);
        queue.enqueueBestEffort.mockResolvedValue(null);
        const done = service.announce("session.new", ROW);
        await jest.advanceTimersByTimeAsync(5_000);
        await expect(done).resolves.toBeUndefined();
        // 3 attempts x 2 providers
        expect(queue.enqueueBestEffort).toHaveBeenCalledTimes(6);
      } finally {
        jest.useRealTimers();
      }
    });

    it("stops retrying once an attempt succeeds", async () => {
      jest.useFakeTimers();
      try {
        const { service, queue } = await makeService([]);
        queue.enqueueBestEffort
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ id: "job" });
        const done = service.announce("session.new", ROW);
        await jest.advanceTimersByTimeAsync(5_000);
        await done;
        expect(queue.enqueueBestEffort).toHaveBeenCalledTimes(4);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("reconcileRecent", () => {
    it("re-enqueues only the push jobs that no longer exist", async () => {
      const { service, queue, db } = await makeService([]);
      (db.client.notification as { findMany: unknown }).findMany = jest
        .fn()
        .mockResolvedValue([{ id: "n1" }, { id: "n2" }]);
      queue.getJob.mockImplementation((_def: unknown, id: string) =>
        Promise.resolve(id === "push_n1_fcm" ? { id } : undefined),
      );
      await expect(service.reconcileRecent()).resolves.toBe(3);
      const ids = (
        queue.enqueueBestEffort.mock.calls as [
          unknown,
          unknown,
          { jobId: string },
        ][]
      ).map((c) => c[2].jobId);
      expect(ids).toEqual(["push_n1_apns", "push_n2_fcm", "push_n2_apns"]);
    });

    it("pages past the first batch so older rows are still checked", async () => {
      const { service, queue, db } = await makeService([]);
      const page = (from: number, n: number) =>
        Array.from({ length: n }, (_, i) => ({ id: `n${from + i}` }));
      const findMany = jest
        .fn()
        .mockResolvedValueOnce(page(0, 500))
        .mockResolvedValueOnce(page(500, 2));
      (db.client.notification as { findMany: unknown }).findMany = findMany;
      queue.getJob.mockResolvedValue({ id: "exists" });

      await expect(service.reconcileRecent()).resolves.toBe(0);

      expect(findMany).toHaveBeenCalledTimes(2);
      expect(findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cursor: { id: "n499" }, skip: 1 }),
      );
      expect(queue.getJob).toHaveBeenCalledWith(
        expect.anything(),
        "push_n501_fcm",
      );
    });

    it("propagates a queue outage so the sweep stops and retries later", async () => {
      const { service, queue, db } = await makeService([]);
      (db.client.notification as { findMany: unknown }).findMany = jest
        .fn()
        .mockResolvedValue([{ id: "n1" }]);
      queue.getJob.mockRejectedValue(new Error("timed out"));
      await expect(service.reconcileRecent()).rejects.toThrow("timed out");
    });
  });

  describe("list", () => {
    it("returns newest first, regardless of read state", async () => {
      const { service } = await makeService([
        row({ id: "n1", sentAt: new Date("2026-09-01T00:00:00.000Z") }),
        row({
          id: "n2",
          sentAt: new Date("2026-09-03T00:00:00.000Z"),
          readAt: new Date("2026-09-04T00:00:00.000Z"),
        }),
        row({ id: "n3", sentAt: new Date("2026-09-02T00:00:00.000Z") }),
      ]);

      const data = await service.list(USER, {});

      expect(data.notifications.map((n) => n.id)).toEqual(["n2", "n3", "n1"]);
    });

    it("counts unread across the whole inbox, not just the page", async () => {
      const { service } = await makeService([
        row({ id: "n1" }),
        row({ id: "n2" }),
        row({ id: "n3" }),
      ]);

      const data = await service.list(USER, { limit: 1, offset: 0 });

      expect(data.notifications).toHaveLength(1);
      expect(data.unreadCount).toBe(3);
    });

    it("pages with limit and offset", async () => {
      const { service } = await makeService([
        row({ id: "n1", sentAt: new Date("2026-09-01T00:00:00.000Z") }),
        row({ id: "n2", sentAt: new Date("2026-09-02T00:00:00.000Z") }),
        row({ id: "n3", sentAt: new Date("2026-09-03T00:00:00.000Z") }),
      ]);

      const data = await service.list(USER, { limit: 2, offset: 1 });

      expect(data.notifications.map((n) => n.id)).toEqual(["n2", "n1"]);
    });

    it("never returns another student's notifications", async () => {
      const { service } = await makeService([
        row({ id: "n1" }),
        row({ id: "n2", userId: "u2" }),
      ]);

      const data = await service.list(USER, {});

      expect(data.notifications.map((n) => n.id)).toEqual(["n1"]);
      expect(data.unreadCount).toBe(1);
    });

    it("serializes instants as ISO strings and absences as null", async () => {
      const { service } = await makeService([
        row({ id: "n1", sessionId: null }),
      ]);

      const [dto] = (await service.list(USER, {})).notifications;

      expect(dto).toEqual({
        id: "n1",
        eventName: "assignment.created",
        title: "New assignment: Môn học Mẫu Một",
        content: "Added to your calendar from DLU.",
        sentAt: "2026-09-01T00:00:00.000Z",
        readAt: null,
        actionTakenAt: null,
        eventEndsAt: null,
        sessionId: null,
        conflictSessionIds: [],
      });
    });
  });

  describe("markRead", () => {
    it("stamps readAt", async () => {
      const { db, service } = await makeService([row({ id: "n1" })]);

      const dto = await service.markRead(USER, "n1");

      expect(dto.readAt).not.toBeNull();
      expect(db.rows[0].readAt).toBeInstanceOf(Date);
    });

    it("is idempotent and keeps the first instant", async () => {
      const first = new Date("2026-09-02T00:00:00.000Z");
      const { db, service } = await makeService([
        row({ id: "n1", readAt: first }),
      ]);

      const dto = await service.markRead(USER, "n1");

      expect(dto.readAt).toBe(first.toISOString());
      expect(db.rows[0].readAt).toBe(first);
    });

    it("404s on another student's notification", async () => {
      const { service } = await makeService([row({ id: "n1", userId: "u2" })]);

      await expect(service.markRead(USER, "n1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("404s on an id that does not exist", async () => {
      const { service } = await makeService([]);

      await expect(service.markRead(USER, "nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("markActionTaken", () => {
    it("stamps actionTakenAt without touching readAt", async () => {
      const { db, service } = await makeService([row({ id: "n1" })]);

      const dto = await service.markActionTaken(USER, "n1");

      expect(dto.actionTakenAt).not.toBeNull();
      expect(dto.readAt).toBeNull();
      expect(db.rows[0].readAt).toBeNull();
    });

    it("404s on another student's notification", async () => {
      const { service } = await makeService([row({ id: "n1", userId: "u2" })]);

      await expect(service.markActionTaken(USER, "n1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("hard-deletes the caller's notification", async () => {
      const { db, service } = await makeService([
        row({ id: "n1" }),
        row({ id: "n2" }),
      ]);

      await expect(service.remove(USER, "n1")).resolves.toEqual({ id: "n1" });
      expect(db.rows.map((r) => r.id)).toEqual(["n2"]);
    });

    it("404s on another student's notification, leaving it in place", async () => {
      const { db, service } = await makeService([
        row({ id: "n1", userId: "u2" }),
      ]);

      await expect(service.remove(USER, "n1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.rows).toHaveLength(1);
    });

    it("404s on an id that does not exist", async () => {
      const { service } = await makeService([]);

      await expect(service.remove(USER, "nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("auto-materializes a session titled from the real ingested title, never a hardcoded demo title", async () => {
      const { db, service } = await makeService([]);

      await service.create("u1", {
        eventName: "lecture.group_updated",
        title: "Timetable for Semester 2 Update",
        content: "Room B12 schedule change.",
        sessionId: null,
        eventEndsAt: null,
      });

      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].title).toBe("Timetable for Semester 2 Update");
    });

    it("does not synthesize a session when materializeSession is false", async () => {
      const { db, service } = await makeService([]);

      const row = await service.create("u1", {
        eventName: "lecture.removed",
        title: "Removed from DLU: Data Structures Lab",
        content: "These classes were taken off your DLU timetable.",
        sessionId: null,
        eventEndsAt: null,
        materializeSession: false,
      });

      expect(db.sessions).toHaveLength(0);
      expect(row.sessionId).toBeNull();
    });
  });

  describe("raiseSamples", () => {
    it("writes a row and emits NEW_SESSION for each, cycling the sample styles", async () => {
      const { db, service } = await makeService([]);
      const emitted: { title: string }[] = [];
      service.notificationEmitter.on("session.new", (p: { title: string }) =>
        emitted.push(p),
      );

      const raised = await service.raiseSamples(USER.id, 3);

      expect(raised).toHaveLength(3);
      expect(db.rows).toHaveLength(3);
      expect(emitted.map((p) => p.title)).toEqual(raised.map((n) => n.title));
      // count > 1 → titles are numbered so a burst is legible
      expect(raised.every((n) => /\(#\d+\)$/.test(n.title))).toBe(true);
    });

    it("does not number the title for a single notification", async () => {
      const { service } = await makeService([]);

      const [only] = await service.raiseSamples(USER.id, 1);

      expect(only.title).not.toMatch(/\(#\d+\)$/);
    });

    it("clamps count to at least 1", async () => {
      const { db, service } = await makeService([]);

      await service.raiseSamples(USER.id, 0);

      expect(db.rows).toHaveLength(1);
    });
  });
});
