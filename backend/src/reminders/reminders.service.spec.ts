import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RemindersService } from "./reminders.service";

const HOUR = 3_600_000;
const NOW = new Date("2026-09-20T10:00:00.000Z");

describe("RemindersService", () => {
  let prisma: {
    sessionReminder: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let service: RemindersService;

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    prisma = {
      sessionReminder: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<RemindersService>(RemindersService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("validation", () => {
    it("defaults to one 60-minute reminder, none for DND", () => {
      expect(service.resolveForCreate("LECTURE", undefined)).toEqual([60]);
      expect(service.resolveForCreate("DND", undefined)).toEqual([]);
      // user default: honoured, 0 = none, DND still excluded, explicit wins
      expect(service.resolveForCreate("LECTURE", undefined, 10)).toEqual([10]);
      expect(service.resolveForCreate("LECTURE", undefined, 0)).toEqual([]);
      expect(service.resolveForCreate("DND", undefined, 10)).toEqual([]);
      expect(service.resolveForCreate("TASK", [15], 10)).toEqual([15]);
    });
    it("honours an explicit list and an explicit empty list", () => {
      expect(service.resolveForCreate("TASK", [15, 1440])).toEqual([1440, 15]);
      expect(service.resolveForCreate("TASK", [])).toEqual([]);
    });
    it("rejects more than two, DND, out-of-range and duplicates", () => {
      expect(() => service.assertValid("TASK", [1, 2, 3])).toThrow(
        BadRequestException,
      );
      expect(() => service.assertValid("DND", [15])).toThrow(
        BadRequestException,
      );
      expect(() => service.assertValid("TASK", [-1])).toThrow(
        BadRequestException,
      );
      expect(() => service.assertValid("TASK", [10081])).toThrow(
        BadRequestException,
      );
      expect(() => service.assertValid("TASK", [15, 15])).toThrow(
        BadRequestException,
      );
      expect(() => service.assertValid("DND", [])).not.toThrow();
      expect(() => service.assertValid("TASK", [0, 60])).not.toThrow();
    });
  });

  describe("replace (diff, keeps fired state)", () => {
    const withWrites = () => {
      const p = prisma as unknown as {
        sessionReminder: {
          findMany: jest.Mock;
          deleteMany: jest.Mock;
          createMany: jest.Mock;
        };
        session: { findMany: jest.Mock };
        $transaction: jest.Mock;
      };
      p.session = { findMany: jest.fn().mockResolvedValue([]) };
      p.sessionReminder.deleteMany = jest.fn().mockReturnValue("del");
      p.sessionReminder.createMany = jest.fn().mockReturnValue("add");
      p.$transaction = jest.fn().mockResolvedValue(undefined);
      return p;
    };

    it("an edit that re-sends the same reminders writes nothing (no re-fire)", async () => {
      const p = withWrites();
      p.sessionReminder.findMany.mockResolvedValue([
        { id: "r1", sessionId: "s1", remindBeforeMinutes: 60 },
      ]);
      await service.replace(["s1"], [60]);
      expect(p.$transaction).not.toHaveBeenCalled();
      expect(p.sessionReminder.deleteMany).not.toHaveBeenCalled();
      expect(p.sessionReminder.createMany).not.toHaveBeenCalled();
    });

    describe("skips reminders that are too late", () => {
      const start = (ms: number) => ({
        id: "s1",
        scheduledStartTime: new Date(NOW.getTime() + ms),
        series: null,
      });
      const run = async (startsInMs: number, minutes: number[]) => {
        const p = withWrites();
        p.sessionReminder.findMany.mockResolvedValue([]);
        p.session.findMany.mockResolvedValue([start(startsInMs)]);
        const res = await service.replace(["s1"], minutes, NOW);
        return { p, res };
      };

      it("past nominal time: not stored, reported skipped", async () => {
        const { p, res } = await run(20 * 60_000, [60]);
        expect(res).toEqual({ applied: [], skipped: [60] });
        expect(p.sessionReminder.createMany).not.toHaveBeenCalled();
      });
      it("nominal exactly now: skipped", async () => {
        const { res } = await run(60 * 60_000, [60]);
        expect(res.skipped).toEqual([60]);
      });
      it("nominal 59 s ahead is skipped, 60 s ahead is stored", async () => {
        expect((await run(60 * 60_000 + 59_000, [60])).res.skipped).toEqual([
          60,
        ]);
        const { p, res } = await run(60 * 60_000 + 60_000, [60]);
        expect(res).toEqual({ applied: [60], skipped: [] });
        expect(p.sessionReminder.createMany).toHaveBeenCalledWith({
          data: [{ sessionId: "s1", remindBeforeMinutes: 60 }],
        });
      });
      it("near start: only the too-early lead is dropped", async () => {
        const { res } = await run(10 * 60_000, [60, 5]);
        expect(res).toEqual({ applied: [5], skipped: [60] });
      });
      it("never skips a recurring series (later occurrences are ahead)", async () => {
        const p = withWrites();
        p.sessionReminder.findMany.mockResolvedValue([]);
        p.session.findMany.mockResolvedValue([
          { ...start(-HOUR), series: { rrule: "FREQ=DAILY" } },
        ]);
        const res = await service.replace(["s1"], [60], NOW);
        expect(res).toEqual({ applied: [60], skipped: [] });
      });
    });

    it("keeps unchanged rows, drops removed ones, adds new ones", async () => {
      const p = withWrites();
      p.sessionReminder.findMany.mockResolvedValue([
        { id: "r1", sessionId: "s1", remindBeforeMinutes: 60 },
        { id: "r2", sessionId: "s1", remindBeforeMinutes: 15 },
      ]);
      await service.replace(["s1", "s2"], [60, 1440]);
      expect(p.sessionReminder.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["r2"] } },
      });
      expect(p.sessionReminder.createMany).toHaveBeenCalledWith({
        data: [
          { sessionId: "s1", remindBeforeMinutes: 1440 },
          { sessionId: "s2", remindBeforeMinutes: 60 },
          { sessionId: "s2", remindBeforeMinutes: 1440 },
        ],
      });
    });
  });
});
