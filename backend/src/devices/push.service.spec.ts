import { EventEmitter2 } from "@nestjs/event-emitter";
import { type Notification } from "../../generated/prisma";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import { PrismaService } from "../prisma/prisma.service";
import { ApnsSender } from "./apns.sender";
import { FcmSender } from "./fcm.sender";
import { PushService } from "./push.service";
import type { SendResult } from "./types";

interface DeviceRow {
  platform: "IOS" | "ANDROID";
  pushToken: string;
  userId: string;
}

function makePrismaDouble(devices: DeviceRow[]) {
  const client = {
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
  result: SendResult = { sent: 0, invalidTokens: [] },
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
  topic: "EXAM",
  kind: "NEW",
  sessionId: "s1",
} as unknown as Notification;

function make(opts: {
  devices?: DeviceRow[];
  fcm?: ReturnType<typeof fakeSender>;
  apns?: ReturnType<typeof fakeSender>;
  emitter?: EventEmitter2;
}) {
  const db = makePrismaDouble(opts.devices ?? []);
  const notifications = {
    notificationEmitter: opts.emitter ?? new EventEmitter2(),
  } as unknown as NotificationsService;
  const fcm = opts.fcm ?? fakeSender(true);
  const apns = opts.apns ?? fakeSender(true);
  const service = new PushService(
    db.client as unknown as PrismaService,
    notifications,
    fcm as unknown as FcmSender,
    apns as unknown as ApnsSender,
  );
  return { db, service, fcm, apns, notifications };
}

describe("PushService", () => {
  describe("sendToUser", () => {
    it("is a no-op when both senders are disabled", async () => {
      const { service, db, fcm, apns } = make({
        devices: [{ platform: "ANDROID", pushToken: "a1", userId: "u1" }],
        fcm: fakeSender(false),
        apns: fakeSender(false),
      });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.findMany).not.toHaveBeenCalled();
      expect(fcm.send).not.toHaveBeenCalled();
      expect(apns.send).not.toHaveBeenCalled();
    });

    it("does nothing when the user has no devices", async () => {
      const { service, fcm, apns } = make({ devices: [] });

      await service.sendToUser("u1", ROW);

      expect(fcm.send).not.toHaveBeenCalled();
      expect(apns.send).not.toHaveBeenCalled();
    });

    it("routes Android tokens to FCM and iOS tokens to APNs, with title/body/data", async () => {
      const { service, fcm, apns } = make({
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
          topic: "EXAM",
          kind: "NEW",
          sessionId: "s1",
          url: "/calendar?session=s1",
        },
      });
      expect(apns.send).toHaveBeenCalledWith(["i1"], expect.anything());
    });

    it("uses the /notifications url when the row has no session", async () => {
      const { service, fcm } = make({
        devices: [{ platform: "ANDROID", pushToken: "a1", userId: "u1" }],
      });

      await service.sendToUser("u1", {
        ...ROW,
        sessionId: null,
      } as unknown as Notification);

      expect(fcm.send).toHaveBeenCalledWith(
        ["a1"],
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: "",
            url: "/notifications",
          }),
        }),
      );
    });

    it("prunes every dead token both senders report", async () => {
      const { service, db } = make({
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
      const { service, db } = make({
        devices: [{ platform: "ANDROID", pushToken: "a1", userId: "u1" }],
      });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("onModuleInit listener", () => {
    it("pushes on a NEW_SESSION emit for the row's user", async () => {
      const emitter = new EventEmitter2();
      const { service } = make({ emitter });
      const spy = jest
        .spyOn(service, "sendToUser")
        .mockResolvedValue(undefined);

      service.onModuleInit();
      emitter.emit(NotificationEvent.NEW_SESSION, ROW);
      await new Promise((r) => setImmediate(r));

      expect(spy).toHaveBeenCalledWith("u1", ROW);
    });

    it("swallows a rejected send so the emitter never sees it", async () => {
      const emitter = new EventEmitter2();
      const { service } = make({ emitter });
      jest.spyOn(service, "sendToUser").mockRejectedValue(new Error("boom"));

      service.onModuleInit();
      expect(() =>
        emitter.emit(NotificationEvent.NEW_SESSION, ROW),
      ).not.toThrow();
      await new Promise((r) => setImmediate(r));
    });
  });
});
