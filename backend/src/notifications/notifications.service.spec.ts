import { NotFoundException } from "@nestjs/common";
import { Prisma, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "./notifications.service";

// ── in-memory Prisma double ────────────────────────────────────────────────

interface Row {
  id: string;
  userId: string;
  sessionId: string | null;
  topic: string;
  kind: string;
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

  const client = {
    notification: {
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
  };

  return { client, rows };
}

// ── fixtures ──────────────────────────────────────────────────────────────

const USER = { id: "u1" } as User;

function row(over: Partial<Row> & { id: string }): Row {
  return {
    userId: "u1",
    sessionId: "s1",
    topic: "ASSIGNMENT",
    kind: "NEW",
    title: "New assignment: Môn học Mẫu Một",
    content: "Added to your calendar from DLU.",
    sentAt: new Date("2026-09-01T00:00:00.000Z"),
    readAt: null,
    actionTakenAt: null,
    eventEndsAt: null,
    ...over,
  };
}

function makeService(rows: Row[]) {
  const db = makePrismaDouble(rows);
  return {
    db,
    service: new NotificationsService(db.client as unknown as PrismaService),
  };
}

describe("NotificationsService", () => {
  describe("list", () => {
    it("returns newest first, regardless of read state", async () => {
      const { service } = makeService([
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
      const { service } = makeService([
        row({ id: "n1" }),
        row({ id: "n2" }),
        row({ id: "n3" }),
      ]);

      const data = await service.list(USER, { limit: 1, offset: 0 });

      expect(data.notifications).toHaveLength(1);
      expect(data.unreadCount).toBe(3);
    });

    it("pages with limit and offset", async () => {
      const { service } = makeService([
        row({ id: "n1", sentAt: new Date("2026-09-01T00:00:00.000Z") }),
        row({ id: "n2", sentAt: new Date("2026-09-02T00:00:00.000Z") }),
        row({ id: "n3", sentAt: new Date("2026-09-03T00:00:00.000Z") }),
      ]);

      const data = await service.list(USER, { limit: 2, offset: 1 });

      expect(data.notifications.map((n) => n.id)).toEqual(["n2", "n1"]);
    });

    it("never returns another student's notifications", async () => {
      const { service } = makeService([
        row({ id: "n1" }),
        row({ id: "n2", userId: "u2" }),
      ]);

      const data = await service.list(USER, {});

      expect(data.notifications.map((n) => n.id)).toEqual(["n1"]);
      expect(data.unreadCount).toBe(1);
    });

    it("serializes instants as ISO strings and absences as null", async () => {
      const { service } = makeService([row({ id: "n1", sessionId: null })]);

      const [dto] = (await service.list(USER, {})).notifications;

      expect(dto).toEqual({
        id: "n1",
        topic: "ASSIGNMENT",
        kind: "NEW",
        title: "New assignment: Môn học Mẫu Một",
        content: "Added to your calendar from DLU.",
        sentAt: "2026-09-01T00:00:00.000Z",
        readAt: null,
        actionTakenAt: null,
        eventEndsAt: null,
        sessionId: null,
      });
    });
  });

  describe("markRead", () => {
    it("stamps readAt", async () => {
      const { db, service } = makeService([row({ id: "n1" })]);

      const dto = await service.markRead(USER, "n1");

      expect(dto.readAt).not.toBeNull();
      expect(db.rows[0].readAt).toBeInstanceOf(Date);
    });

    it("is idempotent and keeps the first instant", async () => {
      const first = new Date("2026-09-02T00:00:00.000Z");
      const { db, service } = makeService([row({ id: "n1", readAt: first })]);

      const dto = await service.markRead(USER, "n1");

      expect(dto.readAt).toBe(first.toISOString());
      expect(db.rows[0].readAt).toBe(first);
    });

    it("404s on another student's notification", async () => {
      const { service } = makeService([row({ id: "n1", userId: "u2" })]);

      await expect(service.markRead(USER, "n1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("404s on an id that does not exist", async () => {
      const { service } = makeService([]);

      await expect(service.markRead(USER, "nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("markActionTaken", () => {
    it("stamps actionTakenAt without touching readAt", async () => {
      const { db, service } = makeService([row({ id: "n1" })]);

      const dto = await service.markActionTaken(USER, "n1");

      expect(dto.actionTakenAt).not.toBeNull();
      expect(dto.readAt).toBeNull();
      expect(db.rows[0].readAt).toBeNull();
    });

    it("404s on another student's notification", async () => {
      const { service } = makeService([row({ id: "n1", userId: "u2" })]);

      await expect(service.markActionTaken(USER, "n1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("hard-deletes the caller's notification", async () => {
      const { db, service } = makeService([
        row({ id: "n1" }),
        row({ id: "n2" }),
      ]);

      await expect(service.remove(USER, "n1")).resolves.toEqual({ id: "n1" });
      expect(db.rows.map((r) => r.id)).toEqual(["n2"]);
    });

    it("404s on another student's notification, leaving it in place", async () => {
      const { db, service } = makeService([row({ id: "n1", userId: "u2" })]);

      await expect(service.remove(USER, "n1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.rows).toHaveLength(1);
    });

    it("404s on an id that does not exist", async () => {
      const { service } = makeService([]);

      await expect(service.remove(USER, "nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
