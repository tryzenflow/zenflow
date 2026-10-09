/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import { QueueService } from "../queue/queue.service";
import { NOTIFY_QUEUE } from "../queue/queues";
import {
  ARM_HORIZON_MS,
  REMINDER_RANDOM,
  ReminderSchedulerService,
  reminderJobId,
} from "./reminder-scheduler.service";

const HOUR = 3_600_000;
const NOW = new Date("2026-09-20T10:00:00.000Z");

function makeRow(over: {
  id?: string;
  startsInMs: number;
  before?: number;
  type?: string;
  firedForStart?: Date | null;
}) {
  return {
    id: over.id ?? "r1",
    remindBeforeMinutes: over.before ?? 60,
    firedForStart: over.firedForStart ?? null,
    sessionId: "s1",
    session: {
      id: "s1",
      userId: "u1",
      title: "Standup",
      location: null,
      type: over.type ?? "LECTURE",
      durationMinutes: 30,
      scheduledStartTime: new Date(NOW.getTime() + over.startsInMs),
      series: null,
      user: { id: "u1", timezone: "UTC" },
    },
  };
}

describe("ReminderSchedulerService", () => {
  let prisma: {
    sessionReminder: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let notifications: { create: jest.Mock; announce: jest.Mock };
  let queue: { enqueueBestEffort: jest.Mock };
  let service: ReminderSchedulerService;
  let rand: jest.Mock;

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    prisma = {
      sessionReminder: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    notifications = {
      create: jest.fn().mockResolvedValue({ id: "n1", userId: "u1" }),
      announce: jest.fn().mockResolvedValue(undefined),
    };
    queue = { enqueueBestEffort: jest.fn().mockResolvedValue({}) };
    rand = jest.fn().mockReturnValue(0);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReminderSchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: QueueService, useValue: queue },
        { provide: REMINDER_RANDOM, useValue: rand },
      ],
    }).compile();
    service = module.get<ReminderSchedulerService>(ReminderSchedulerService);
  });

  afterEach(() => jest.useRealTimers());

  describe("sweep / arming", () => {
    it("enqueues a delayed reminder job with a stable id for a reminder inside the horizon", async () => {
      const row = makeRow({ startsInMs: 3 * HOUR });
      prisma.sessionReminder.findMany.mockResolvedValue([row]);
      await service.sweep();
      const start = row.session.scheduledStartTime;
      expect(queue.enqueueBestEffort).toHaveBeenCalledWith(
        NOTIFY_QUEUE,
        { type: "reminder", reminderId: "r1", startsAt: start.toISOString() },
        {
          jobId: reminderJobId("r1", start.getTime()),
          delayMs: 2 * HOUR + 5_000,
        },
      );
    });

    it("sweeping twice uses the same job id (BullMQ dedupes)", async () => {
      prisma.sessionReminder.findMany.mockResolvedValue([
        makeRow({ startsInMs: 3 * HOUR }),
      ]);
      await service.sweep();
      await service.sweep();
      const ids = queue.enqueueBestEffort.mock.calls.map((c) => c[2].jobId);
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).not.toContain(":");
    });

    it("does not arm a reminder beyond the horizon", async () => {
      prisma.sessionReminder.findMany.mockResolvedValue([
        makeRow({ startsInMs: 60 * 24 * HOUR }),
      ]);
      await service.sweep();
      expect(queue.enqueueBestEffort).not.toHaveBeenCalled();
      expect(ARM_HORIZON_MS).toBe(24 * HOUR);
    });

    it("skips sessions that already started", async () => {
      prisma.sessionReminder.findMany.mockResolvedValue([
        makeRow({ startsInMs: -HOUR }),
      ]);
      await service.sweep();
      expect(queue.enqueueBestEffort).not.toHaveBeenCalled();
    });

    it("a moved session gets a job for the new start", async () => {
      prisma.sessionReminder.findMany.mockResolvedValueOnce([
        makeRow({ startsInMs: 3 * HOUR }),
      ]);
      await service.sweep();
      prisma.sessionReminder.findMany.mockResolvedValueOnce([
        makeRow({ startsInMs: 5 * HOUR }),
      ]);
      await service.sweep();
      const ids = queue.enqueueBestEffort.mock.calls.map((c) => c[2].jobId);
      expect(new Set(ids).size).toBe(2);
    });

    it("swallows a failing sweep", async () => {
      prisma.sessionReminder.findMany.mockRejectedValue(new Error("db"));
      await expect(service.sweep()).resolves.toBeUndefined();
    });

    describe("jitter", () => {
      const delayFor = async (r: number, startsInMs: number, before = 60) => {
        rand.mockReturnValue(r);
        prisma.sessionReminder.findMany.mockResolvedValue([
          makeRow({ startsInMs, before }),
        ]);
        await service.sweep();
        return queue.enqueueBestEffort.mock.calls[0][2].delayMs as number;
      };

      it("delays by 5 s at the low bound, never earlier", async () => {
        expect(await delayFor(0, 3 * HOUR)).toBe(2 * HOUR + 5_000);
      });
      it("delays by 10 s at the high bound", async () => {
        expect(await delayFor(1, 3 * HOUR)).toBe(2 * HOUR + 10_000);
      });
      it("is capped so it never lands after session start", async () => {
        expect(await delayFor(1, 3_000, 0)).toBe(2_000);
      });
    });
  });

  describe("fire", () => {
    it("two workers firing the same reminder send it once (claim)", async () => {
      const row = makeRow({ startsInMs: HOUR });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      prisma.sessionReminder.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const start = row.session.scheduledStartTime.getTime();
      await Promise.all([service.fire("r1", start), service.fire("r1", start)]);
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.announce).toHaveBeenCalledTimes(1);
    });

    it("claims and creates the row in one transaction, then notifies", async () => {
      const row = makeRow({ startsInMs: HOUR });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.fire("r1", row.session.scheduledStartTime.getTime());
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({
          eventName: "reminder.fired",
          sessionId: "s1",
          title: "Class in 1 hour: Standup",
          content: expect.stringContaining("Standup begins at"),
        }),
        prisma,
      );
      expect(notifications.announce).toHaveBeenCalledWith(
        NotificationEvent.NEW_SESSION,
        expect.anything(),
      );
    });

    it("a failed row insert propagates (job retries) and sends nothing", async () => {
      const row = makeRow({ startsInMs: HOUR });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      notifications.create.mockRejectedValue(new Error("db down"));
      await expect(
        service.fire("r1", row.session.scheduledStartTime.getTime()),
      ).rejects.toThrow("db down");
      expect(notifications.announce).not.toHaveBeenCalled();
    });

    it("catch-up: fires a reminder missed by <= 2 min, with the real time left", async () => {
      const row = makeRow({ startsInMs: 59 * 60_000, before: 60 });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.fire("r1", row.session.scheduledStartTime.getTime());
      expect(notifications.create).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({ title: "Class in 59 minutes: Standup" }),
        prisma,
      );
    });

    it("catch-up: drops a reminder missed by more than 2 min", async () => {
      const row = makeRow({ startsInMs: 20 * 60_000, before: 60 });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.fire("r1", row.session.scheduledStartTime.getTime());
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it("does not fire when the session was moved (arms the new start instead)", async () => {
      const row = makeRow({ startsInMs: 4 * HOUR });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.fire("r1", NOW.getTime() + 2 * HOUR);
      expect(notifications.create).not.toHaveBeenCalled();
      expect(queue.enqueueBestEffort).toHaveBeenCalledWith(
        NOTIFY_QUEUE,
        expect.objectContaining({ reminderId: "r1" }),
        expect.objectContaining({
          jobId: reminderJobId("r1", row.session.scheduledStartTime.getTime()),
        }),
      );
    });

    it("does not fire for a started session, a deleted reminder or a lost claim", async () => {
      prisma.sessionReminder.findUnique.mockResolvedValueOnce(
        makeRow({ startsInMs: -HOUR }),
      );
      await service.fire("r1", NOW.getTime() - HOUR);
      prisma.sessionReminder.findUnique.mockResolvedValueOnce(null);
      await service.fire("r1", 0);
      const row = makeRow({ startsInMs: HOUR });
      prisma.sessionReminder.findUnique.mockResolvedValueOnce(row);
      prisma.sessionReminder.updateMany.mockResolvedValueOnce({ count: 0 });
      await service.fire("r1", row.session.scheduledStartTime.getTime());
      expect(notifications.create).not.toHaveBeenCalled();
      expect(notifications.announce).not.toHaveBeenCalled();
    });

    it("never fires for DND", async () => {
      const row = makeRow({ startsInMs: HOUR, type: "DND" });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.fire("r1", row.session.scheduledStartTime.getTime());
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });
});
