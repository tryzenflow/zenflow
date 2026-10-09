import { Test } from "@nestjs/testing";
import { buildReminderText } from "../scheduler/core/reminder";
import { localizeNotification } from "./localize-notification";
import { NotificationsService } from "./notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../devices/push.service";
import { FcmSender } from "../devices/fcm.sender";
import { ApnsSender } from "../devices/apns.sender";
import type { PushMessage, SendResult } from "../devices/types";
import type { User } from "../../generated/prisma";
import { ConfigService } from "@nestjs/config";
import { NotificationPubSub } from "./notification-pubsub.service";
import { QueueService } from "../queue/queue.service";

async function build(
  prisma: unknown,
  sender: { enabled: boolean; send: jest.Mock } = {
    enabled: false,
    send: jest.fn(),
  },
) {
  const module = await Test.createTestingModule({
    providers: [
      NotificationsService,
      NotificationPubSub,
      PushService,
      { provide: ConfigService, useValue: new ConfigService({}) },
      { provide: PrismaService, useValue: prisma },
      { provide: QueueService, useValue: { enqueueBestEffort: jest.fn() } },
      { provide: FcmSender, useValue: sender },
      { provide: ApnsSender, useValue: sender },
    ],
  }).compile();
  return {
    service: module.get(NotificationsService),
    push: module.get(PushService),
  };
}

describe("Vietnamese notification delivery", () => {
  it("renders legacy canonical inbox rows in the current language after switching back to English", async () => {
    const legacy = {
      id: "n",
      userId: "u",
      eventName: "exam.created",
      title: "New exam: Algorithms",
      content: "Added from your portal. Plan revision sessions before it.",
      sentAt: new Date(),
      readAt: null,
      actionTakenAt: null,
      eventEndsAt: null,
      sessionId: "s",
    };
    const prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([legacy]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const { service } = await build(prisma);
    const vi = await service.list({ id: "u", lang: "VI_VN" } as User, {});
    expect(vi.notifications[0].title).toBe("Lịch thi mới: Algorithms");
    const en = await service.list({ id: "u", lang: "EN_US" } as User, {});
    expect(en.notifications[0].title).toBe(legacy.title);
    expect(en.notifications[0].content).toBe(legacy.content);
    expect(legacy.title).toBe("New exam: Algorithms");
  });
  it.each(["VI_VN", "EN_US"])(
    "keeps canonical stored copy and delivers matching inbox/SSE/push text for %s",
    async (lang) => {
      const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "n",
          sentAt: new Date(),
          readAt: null,
          actionTakenAt: null,
          ...data,
        }),
      );
      const prisma = {
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ lang, allowNotifications: true }),
        },
        notification: { create },
        userDevice: {
          findMany: jest.fn().mockResolvedValue([
            { platform: "ANDROID", pushToken: "android" },
            { platform: "IOS", pushToken: "ios" },
          ]),
        },
      };
      const sender = {
        enabled: true,
        send: jest
          .fn<Promise<SendResult>, [string[], PushMessage]>()
          .mockResolvedValue({ sent: 1, invalidTokens: [] }),
      };
      const { service, push } = await build(prisma, sender);
      const row = await service.create("u", {
        eventName: "assignment.group_created",
        title: "You have a new assignment from LMS",
        content: "Synced from DLU. Tap to see it on your calendar.",
        sessionId: "s",
        eventEndsAt: null,
      });
      expect(create.mock.calls[0][0].data.title).toBe(
        "You have a new assignment from LMS",
      );
      expect(row.title).toBe(
        lang === "VI_VN"
          ? "Bạn có 1 bài tập mới từ LMS"
          : "You have a new assignment from LMS",
      );
      const listener = jest.fn();
      service.notificationEmitter.on("test", listener);
      service.notify("test", row);
      expect(listener).toHaveBeenCalledWith(row);
      await push.sendToUser("u", row);
      expect(sender.send).toHaveBeenCalledTimes(2);
      expect(sender.send.mock.calls[0][1]).toMatchObject({
        title: row.title,
        body: row.content,
        data: { notificationId: "n", eventName: row.eventName, sessionId: "s" },
      });
    },
  );

  it.each(["TASK", "EXAM", "ASSIGNMENT", "LECTURE"])(
    "translates reminder %s date and duration while preserving title/location",
    (type) => {
      const text = buildReminderText({
        sessionTitle: "English course",
        startsAt: new Date("2026-10-06T03:30:00Z"),
        now: new Date("2026-10-06T02:00:00Z"),
        timezone: "Asia/Ho_Chi_Minh",
        location: "Room A305",
        type,
      });
      const row = { ...text, eventName: "reminder.fired" };
      const vi = localizeNotification(row, "VI_VN");
      expect(vi.title).toContain("1 giờ 30 phút: English course");
      expect(vi.content).toContain("Thứ 3, 6/10, 10:30");
      if (type !== "ASSIGNMENT") expect(vi.content).toContain("tại Room A305");
      expect(localizeNotification(row, "EN_US")).toEqual(row);
    },
  );

  it("translates mixed digest changes and exact conflict copy", () => {
    const vi = localizeNotification(
      {
        eventName: "lecture.group_created",
        title:
          "You have 2 new lectures, 1 change to your lectures, 1 lecture removed from the portal",
        content: "Synced from DLU. They're no longer on your calendar.",
      },
      "VI_VN",
    );
    expect(vi.title).toBe(
      "Bạn có 2 buổi học mới, 1 thay đổi về lịch học, 1 buổi học đã xóa từ cổng sinh viên",
    );
    expect(
      localizeNotification(
        {
          eventName: "sync_conflict.lecture",
          title: "Schedule conflicts after syncing your timetable",
          content:
            "After syncing with your timetable, we detected 2 conflicts with your own tasks. Reschedule them all?",
        },
        "VI_VN",
      ).content,
    ).toBe(
      "Sau khi đồng bộ thời khóa biểu, đã phát hiện 2 lịch trùng với các công việc của bạn. Sắp xếp lại tất cả?",
    );
  });

  it("leaves unknown/custom copy unchanged", () => {
    const row = {
      eventName: "custom",
      title: "My English title",
      content: "My note",
    };
    expect(localizeNotification(row, "VI_VN")).toEqual(row);
  });
});
