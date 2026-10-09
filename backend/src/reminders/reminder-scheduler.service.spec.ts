/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { SchedulerRegistry } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import {
  ARM_HORIZON_MS,
  REMINDER_RANDOM,
  ReminderSchedulerService,
  reminderJobName,
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
  let registry: SchedulerRegistry;
  let prisma: {
    sessionReminder: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let notifications: { create: jest.Mock; notify: jest.Mock };
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
    };
    notifications = {
      create: jest.fn().mockResolvedValue({ id: "n1", userId: "u1" }),
      notify: jest.fn(),
    };
    rand = jest.fn().mockReturnValue(0);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReminderSchedulerService,
        SchedulerRegistry,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: REMINDER_RANDOM, useValue: rand },
      ],
    }).compile();
    service = module.get<ReminderSchedulerService>(ReminderSchedulerService);
    registry = module.get<SchedulerRegistry>(SchedulerRegistry);
  });

  afterEach(() => {
    for (const name of registry.getTimeouts()) registry.deleteTimeout(name);
    jest.useRealTimers();
  });

  describe("sweep / arming", () => {
    it("arms a timeout for a reminder inside the horizon", async () => {
      prisma.sessionReminder.findMany.mockResolvedValue([
        makeRow({ startsInMs: 3 * HOUR }),
      ]);
      await service.sweep();
      expect(registry.doesExist("timeout", reminderJobName("r1"))).toBe(true);
    });

    it("does not arm a reminder beyond the 24h horizon (32-bit overflow guard)", async () => {
      prisma.sessionReminder.findMany.mockResolvedValue([
        makeRow({ startsInMs: 60 * 24 * HOUR }),
      ]);
      await service.sweep();
      expect(registry.getTimeouts()).toHaveLength(0);
      expect(ARM_HORIZON_MS).toBeLessThan(2 ** 31 - 1);
    });

    describe("jitter", () => {
      const armWith = async (r: number, startsInMs: number, before = 60) => {
        rand.mockReturnValue(r);
        const row = makeRow({ startsInMs, before });
        prisma.sessionReminder.findMany.mockResolvedValue([row]);
        prisma.sessionReminder.findUnique.mockResolvedValue(row);
        await service.sweep();
      };
      const firedAfter = async (ms: number) => {
        await jest.advanceTimersByTimeAsync(ms);
        return notifications.create.mock.calls.length > 0;
      };

      it("delays by 5 s at the low bound, never earlier", async () => {
        await armWith(0, 3 * HOUR);
        const nominal = 2 * HOUR;
        expect(await firedAfter(nominal + 4_999)).toBe(false);
        expect(await firedAfter(1)).toBe(true);
      });
      it("delays by 10 s at the high bound", async () => {
        await armWith(1, 3 * HOUR);
        const nominal = 2 * HOUR;
        expect(await firedAfter(nominal + 9_999)).toBe(false);
        expect(await firedAfter(1)).toBe(true);
      });
      it("is capped so it never lands after session start", async () => {
        // lead 0 -> nominal == start (3 s away): jitter would overshoot, so
        // it fires 1 s before start (a timer at start would find it started).
        await armWith(1, 3_000, 0);
        expect(await firedAfter(1_999)).toBe(false);
        expect(await firedAfter(1)).toBe(true);
      });
    });

    it("cancels a timer whose reminder no longer exists", async () => {
      prisma.sessionReminder.findMany.mockResolvedValueOnce([
        makeRow({ startsInMs: 3 * HOUR }),
      ]);
      await service.sweep();
      prisma.sessionReminder.findMany.mockResolvedValueOnce([]);
      await service.sweep();
      expect(registry.getTimeouts()).toHaveLength(0);
    });

    it("re-arms when the session was moved", async () => {
      prisma.sessionReminder.findMany.mockResolvedValueOnce([
        makeRow({ startsInMs: 3 * HOUR }),
      ]);
      await service.sweep();
      prisma.sessionReminder.findMany.mockResolvedValueOnce([
        makeRow({ startsInMs: 5 * HOUR }),
      ]);
      await service.sweep();
      expect(registry.getTimeouts()).toEqual([reminderJobName("r1")]);
    });

    it("skips sessions that already started", async () => {
      prisma.sessionReminder.findMany.mockResolvedValue([
        makeRow({ startsInMs: -HOUR }),
      ]);
      await service.sweep();
      expect(registry.getTimeouts()).toHaveLength(0);
    });

    it("cancel() removes the timer", async () => {
      prisma.sessionReminder.findMany.mockResolvedValue([
        makeRow({ startsInMs: 3 * HOUR }),
      ]);
      await service.sweep();
      service.cancel("r1");
      expect(registry.getTimeouts()).toHaveLength(0);
    });
  });

  describe("fire", () => {
    it("two workers firing the same reminder send it once (claim)", async () => {
      const row = makeRow({ startsInMs: HOUR });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      // First claim wins, the overlapping worker's updateMany matches nothing.
      prisma.sessionReminder.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const start = row.session.scheduledStartTime.getTime();
      await Promise.all([service.fire("r1", start), service.fire("r1", start)]);
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });

    it("creates a REMINDER notification and emits it", async () => {
      const row = makeRow({ startsInMs: HOUR });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.fire("r1", row.session.scheduledStartTime.getTime());
      expect(notifications.create).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({
          eventName: "reminder.fired",
          sessionId: "s1",
          title: "Class in 1 hour: Standup",
          content: expect.stringContaining("Standup begins at"),
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        NotificationEvent.NEW_SESSION,
        expect.anything(),
      );
    });

    it("restart catch-up: fires a reminder missed by <= 2 min, with the real time left", async () => {
      const row = makeRow({ startsInMs: 59 * 60_000, before: 60 });
      prisma.sessionReminder.findMany.mockResolvedValue([row]);
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.sweep();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(notifications.create).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({ title: "Class in 59 minutes: Standup" }),
      );
    });

    it("restart catch-up: drops a reminder missed by more than 2 min", async () => {
      const row = makeRow({ startsInMs: 20 * 60_000, before: 60 });
      prisma.sessionReminder.findMany.mockResolvedValue([row]);
      await service.sweep();
      expect(registry.getTimeouts()).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it("does not fire when the session was moved (re-arms instead)", async () => {
      const row = makeRow({ startsInMs: 4 * HOUR });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.fire("r1", NOW.getTime() + 2 * HOUR);
      expect(notifications.create).not.toHaveBeenCalled();
      expect(registry.doesExist("timeout", reminderJobName("r1"))).toBe(true);
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
    });

    it("never fires for DND", async () => {
      const row = makeRow({ startsInMs: HOUR, type: "DND" });
      prisma.sessionReminder.findUnique.mockResolvedValue(row);
      await service.fire("r1", row.session.scheduledStartTime.getTime());
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });
});
