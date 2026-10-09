import { Test, TestingModule } from "@nestjs/testing";
import { type Notification } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { ApnsSender } from "./apns.sender";
import { FcmSender } from "./fcm.sender";
import {
  PushProviderError,
  PushService,
  type ProviderGuard,
} from "./push.service";
import type { SendResult } from "./types";

interface DeviceRow {
  platform: "IOS" | "ANDROID";
  pushToken: string;
  userId: string;
}

function makePrismaDouble(devices: DeviceRow[], allowNotifications = true) {
  const client = {
    user: {
      findUnique: jest.fn(() => Promise.resolve({ allowNotifications })),
    },
    userDevice: {
      findMany: jest.fn((args: { where: { userId: string } }) =>
        Promise.resolve(devices.filter((d) => d.userId === args.where.userId)),
      ),
      deleteMany: jest.fn(
        (args: { where: { pushToken: { in: string[] } } }) => {
          const before = devices.length;
          for (let i = devices.length - 1; i >= 0; i--) {
            if (args.where.pushToken.in.includes(devices[i].pushToken)) {
              devices.splice(i, 1);
            }
          }
          return Promise.resolve({ count: before - devices.length });
        },
      ),
    },
  };
  return { client, devices };
}

function fakeSender(
  enabled: boolean,
  result: SendResult = { sent: 1, invalidTokens: [] },
) {
  return {
    enabled,
    send: jest.fn().mockResolvedValue(result),
  };
}

const ROW = {
  id: "n1",
  userId: "u1",
  title: "New exam: Môn học Mẫu Một",
  content: "Added to your calendar from DLU.",
  eventName: "exam.created",
  sessionId: "s1",
} as unknown as Notification;

async function make(opts: {
  devices?: DeviceRow[];
  fcm?: ReturnType<typeof fakeSender>;
  apns?: ReturnType<typeof fakeSender>;
  allowNotifications?: boolean;
}) {
  const db = makePrismaDouble(opts.devices ?? [], opts.allowNotifications);
  const fcm = opts.fcm ?? fakeSender(true);
  const apns = opts.apns ?? fakeSender(true);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PushService,
      { provide: PrismaService, useValue: db.client },
      { provide: FcmSender, useValue: fcm },
      { provide: ApnsSender, useValue: apns },
    ],
  }).compile();
  const service = module.get<PushService>(PushService);

  return { db, service, fcm, apns };
}

describe("PushService", () => {
  describe("sendToUser", () => {
    it("is a no-op when both senders are disabled", async () => {
      const { service, db, fcm, apns } = await make({
        devices: [{ platform: "ANDROID", pushToken: "a1", userId: "u1" }],
        fcm: fakeSender(false),
        apns: fakeSender(false),
      });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.findMany).not.toHaveBeenCalled();
      expect(fcm.send).not.toHaveBeenCalled();
      expect(apns.send).not.toHaveBeenCalled();
    });

    it("skips native push when the user has allowNotifications=false", async () => {
      const { service, db, fcm, apns } = await make({
        devices: [{ platform: "ANDROID", pushToken: "a1", userId: "u1" }],
        allowNotifications: false,
      });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.findMany).not.toHaveBeenCalled();
      expect(fcm.send).not.toHaveBeenCalled();
      expect(apns.send).not.toHaveBeenCalled();
    });

    it("does nothing when the user has no devices", async () => {
      const { service, fcm, apns } = await make({ devices: [] });

      await service.sendToUser("u1", ROW);

      expect(fcm.send).not.toHaveBeenCalled();
      expect(apns.send).not.toHaveBeenCalled();
    });

    it("routes Android tokens to FCM and iOS tokens to APNs, with title/body/data", async () => {
      const { service, fcm, apns } = await make({
        devices: [
          { platform: "ANDROID", pushToken: "a1", userId: "u1" },
          { platform: "ANDROID", pushToken: "a2", userId: "u1" },
          { platform: "IOS", pushToken: "i1", userId: "u1" },
          { platform: "ANDROID", pushToken: "other", userId: "u2" },
        ],
      });

      await service.sendToUser("u1", ROW);

      expect(fcm.send).toHaveBeenCalledWith(["a1", "a2"], {
        title: ROW.title,
        body: ROW.content,
        data: {
          notificationId: "n1",
          eventName: "exam.created",
          sessionId: "s1",
          url: "/calendar?session=s1",
        },
        tone: "default",
      });
      expect(apns.send).toHaveBeenCalledWith(["i1"], expect.anything());
    });

    it("uses the /notifications url when the row has no session", async () => {
      const { service, fcm } = await make({
        devices: [{ platform: "ANDROID", pushToken: "a1", userId: "u1" }],
      });

      await service.sendToUser("u1", {
        ...ROW,
        sessionId: null,
      });

      expect(fcm.send).toHaveBeenCalledWith(
        ["a1"],
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: "",
            url: "/notifications",
          }) as unknown,
        }),
      );
    });

    it("prunes every dead token both senders report", async () => {
      const { service, db } = await make({
        devices: [
          { platform: "ANDROID", pushToken: "a-dead", userId: "u1" },
          { platform: "ANDROID", pushToken: "a-ok", userId: "u1" },
          { platform: "IOS", pushToken: "i-dead", userId: "u1" },
        ],
        fcm: fakeSender(true, { sent: 1, invalidTokens: ["a-dead"] }),
        apns: fakeSender(true, { sent: 0, invalidTokens: ["i-dead"] }),
      });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.deleteMany).toHaveBeenCalledWith({
        where: { pushToken: { in: ["a-dead", "i-dead"] } },
      });
      expect(db.devices.map((d) => d.pushToken)).toEqual(["a-ok"]);
    });

    it("does not call deleteMany when nothing is stale", async () => {
      const { service, db } = await make({
        devices: [{ platform: "ANDROID", pushToken: "a1", userId: "u1" }],
      });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("providers", () => {
    const BOTH: DeviceRow[] = [
      { platform: "ANDROID", pushToken: "a1", userId: "u1" },
      { platform: "IOS", pushToken: "i1", userId: "u1" },
    ];

    it("a per-provider job only touches that provider", async () => {
      const { service, fcm, apns } = await make({ devices: BOTH });

      await service.sendToUser("u1", ROW, { provider: "apns" });

      expect(fcm.send).not.toHaveBeenCalled();
      expect(apns.send).toHaveBeenCalledWith(["i1"], expect.anything());
    });

    it("runs each provider through the guard under its own name", async () => {
      const { service } = await make({
        devices: BOTH,
        fcm: fakeSender(true, { sent: 1, invalidTokens: [] }),
        apns: fakeSender(true, { sent: 1, invalidTokens: [] }),
      });
      const calls: string[] = [];
      const guard: ProviderGuard = (p, fn) => {
        calls.push(p);
        return fn();
      };

      await service.sendToUser("u1", ROW, { guard });

      expect(calls.sort()).toEqual(["apns", "fcm"]);
    });

    it("throws PushProviderError when every token failed transiently, so the job retries", async () => {
      const { service } = await make({
        devices: BOTH,
        fcm: fakeSender(true, { sent: 0, invalidTokens: [] }),
        apns: fakeSender(true, { sent: 1, invalidTokens: [] }),
      });

      await expect(service.sendToUser("u1", ROW)).rejects.toBeInstanceOf(
        PushProviderError,
      );
    });

    it("treats all-dead tokens as handled (pruned, no retry)", async () => {
      const { service, db } = await make({
        devices: [BOTH[0]],
        fcm: fakeSender(true, { sent: 0, invalidTokens: ["a1"] }),
      });

      await expect(service.sendToUser("u1", ROW)).resolves.toBeUndefined();
      expect(db.devices).toHaveLength(0);
    });

    it("a guard rejection (breaker open) still lets the other provider finish and prune", async () => {
      const { service, apns } = await make({
        devices: BOTH,
        apns: fakeSender(true, { sent: 1, invalidTokens: [] }),
      });
      const open = new Error("parked");
      const guard = <T>(p: string, fn: () => Promise<T>) =>
        p === "fcm" ? Promise.reject(open) : fn();

      await expect(service.sendToUser("u1", ROW, { guard })).rejects.toBe(open);
      expect(apns.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("deliver", () => {
    it("loads the row by id and sends to its user", async () => {
      const { service, db } = await make({});
      (db.client as unknown as Record<string, unknown>).notification = {
        findUnique: jest.fn().mockResolvedValue(ROW),
      };
      const spy = jest
        .spyOn(service, "sendToUser")
        .mockResolvedValue(undefined);

      await service.deliver("n1", { provider: "fcm" });

      expect(spy).toHaveBeenCalledWith("u1", ROW, { provider: "fcm" });
    });

    it("throws when the row is missing so BullMQ retries", async () => {
      const { service, db } = await make({});
      (db.client as unknown as Record<string, unknown>).notification = {
        findUnique: jest.fn().mockResolvedValue(null),
      };

      await expect(
        service.deliver("gone", { provider: "fcm" }),
      ).rejects.toThrow(/not found/);
    });
  });
});
