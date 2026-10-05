import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { DevicesService } from "./devices.service";

interface Row {
  id: string;
  platform: "IOS" | "ANDROID";
  pushToken: string;
  userId: string;
  lastSeenAt: Date | null;
}

/** In-memory `userDevice` double: just `upsert` (on pushToken) + `deleteMany`. */
function makePrismaDouble(rows: Row[]) {
  let seq = rows.length;
  const client = {
    userDevice: {
      upsert: (args: {
        where: { pushToken: string };
        create: Omit<Row, "id">;
        update: Partial<Row>;
      }) => {
        const existing = rows.find((r) => r.pushToken === args.where.pushToken);
        if (existing) {
          Object.assign(existing, args.update);
          return Promise.resolve({ id: existing.id });
        }
        const created: Row = { id: `d${++seq}`, ...args.create };
        rows.push(created);
        return Promise.resolve({ id: created.id });
      },
      count: (args: { where: { pushToken: string; userId: string } }) =>
        Promise.resolve(
          rows.filter(
            (r) =>
              r.pushToken === args.where.pushToken &&
              r.userId === args.where.userId,
          ).length,
        ),
      deleteMany: (args: { where: { pushToken: string; userId: string } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (
            rows[i].pushToken === args.where.pushToken &&
            rows[i].userId === args.where.userId
          ) {
            rows.splice(i, 1);
          }
        }
        return Promise.resolve({ count: before - rows.length });
      },
    },
  };
  return { client, rows };
}

const USER = { id: "u1" } as User;

function makeService(rows: Row[] = []) {
  const db = makePrismaDouble(rows);
  return {
    db,
    service: new DevicesService(db.client as unknown as PrismaService),
  };
}

describe("DevicesService", () => {
  describe("registerDevice", () => {
    it("creates a row for a new token, stamping the owner", async () => {
      const { db, service } = makeService();

      const { id } = await service.registerDevice(USER, {
        platform: "ANDROID",
        pushToken: "tok-a",
      });

      expect(id).toBeDefined();
      expect(db.rows).toHaveLength(1);
      expect(db.rows[0]).toMatchObject({
        pushToken: "tok-a",
        platform: "ANDROID",
        userId: "u1",
      });
      expect(db.rows[0].lastSeenAt).toBeInstanceOf(Date);
    });

    it("re-homes an existing token to the caller instead of duplicating", async () => {
      const { db, service } = makeService([
        {
          id: "d1",
          platform: "IOS",
          pushToken: "tok-shared",
          userId: "someone-else",
          lastSeenAt: null,
        },
      ]);

      const { id } = await service.registerDevice(USER, {
        platform: "ANDROID",
        pushToken: "tok-shared",
      });

      expect(id).toBe("d1");
      expect(db.rows).toHaveLength(1);
      expect(db.rows[0]).toMatchObject({
        userId: "u1",
        platform: "ANDROID",
      });
      expect(db.rows[0].lastSeenAt).toBeInstanceOf(Date);
    });
  });

  describe("unregisterDevice", () => {
    it("removes the caller's row and echoes the token", async () => {
      const { db, service } = makeService([
        {
          id: "d1",
          platform: "ANDROID",
          pushToken: "tok-a",
          userId: "u1",
          lastSeenAt: null,
        },
      ]);

      await expect(service.unregisterDevice(USER, "tok-a")).resolves.toEqual({
        pushToken: "tok-a",
      });
      expect(db.rows).toHaveLength(0);
    });

    it("is a no-op for another user's token, leaving it in place", async () => {
      const { db, service } = makeService([
        {
          id: "d1",
          platform: "ANDROID",
          pushToken: "tok-a",
          userId: "someone-else",
          lastSeenAt: null,
        },
      ]);

      await expect(service.unregisterDevice(USER, "tok-a")).resolves.toEqual({
        pushToken: "tok-a",
      });
      expect(db.rows).toHaveLength(1);
    });

    it("is a no-op (not an error) for an unknown token", async () => {
      const { service } = makeService([]);

      await expect(service.unregisterDevice(USER, "nope")).resolves.toEqual({
        pushToken: "nope",
      });
    });
  });

  describe("deviceStatus", () => {
    const row = (userId: string): Row => ({
      id: "d1",
      platform: "ANDROID",
      pushToken: "tok-a",
      userId,
      lastSeenAt: null,
    });

    it("is registered when the caller owns the token", async () => {
      const { service } = makeService([row("u1")]);
      await expect(service.deviceStatus(USER, "tok-a")).resolves.toEqual({
        registered: true,
      });
    });

    it("is not registered when another user owns the token", async () => {
      const { service } = makeService([row("someone-else")]);
      await expect(service.deviceStatus(USER, "tok-a")).resolves.toEqual({
        registered: false,
      });
    });

    it("is not registered for an unknown token", async () => {
      const { service } = makeService([]);
      await expect(service.deviceStatus(USER, "nope")).resolves.toEqual({
        registered: false,
      });
    });
  });
});
