import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { Event } from "../scheduler/interfaces";
import { UpdateEventDto } from "./dto/update-schedule.dto";
import { fromZonedTime } from "date-fns-tz";
import { DateRangeDto } from "src/common/dto/date-range.dto";

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async findScheduledBlocks(
    userId: string,
    { start, end }: DateRangeDto,
    timezone: string,
  ) {
    const startDate = fromZonedTime(new Date(`${start}T00:00:00`), timezone);
    const endDate = fromZonedTime(new Date(`${end}T23:59:59`), timezone);
    const events = await this.prisma.event.findMany({
      where: {
        task: { userId },
        start: { gte: startDate, lte: endDate },
        end: { gte: startDate, lte: endDate },
      },
      include: {
        task: { select: { title: true, energy: true } },
      },
    });
    return events;
  }

  async schedule(
    date: string, // YYYY-MM-DD (local date)
    events: Event[],
    timezone: string, // e.g. "Asia/Bangkok"
  ) {
    await this.prisma.$transaction(async (tx) => {
      for (const event of events) {
        await tx.event.upsert({
          where: {
            id: `${date}/${event.splitIndex ?? 0}/${event.taskId}`,
          },
          update: {
            start: minutesToUtc(date, event.start || 0, timezone),
            end: minutesToUtc(date, event.end || 0, timezone),
            splitIndex: event.splitIndex || 0,
          },
          create: {
            id: `${date}/${event.splitIndex ?? 0}/${event.taskId}`,
            taskId: event.taskId,
            start: minutesToUtc(date, event.start || 0, timezone),
            end: minutesToUtc(date, event.end || 0, timezone),
            splitIndex: event.splitIndex || 0,
          },
        });
      }
    });
  }

  async update(
    blockId: string,
    { interval, completed, date }: UpdateEventDto,
    userId: string,
    timezone: string,
  ) {
    try {
      const updated = await this.prisma.event.update({
        where: { id: blockId, task: { userId } },
        data: {
          start: interval
            ? minutesToUtc(date, interval.start, timezone)
            : undefined,
          end: interval
            ? minutesToUtc(date, interval.end, timezone)
            : undefined,
          completed,
          isDirty: true,
        },
        select: { task: { select: { energy: true } } },
      });
      return updated;
    } catch (error) {
      if (error === PostgresErrorCode.RecordNotFound) {
        throw new NotFoundException({
          success: false,
          message: `Cannot update scheduled task because it does not exist`,
        });
      }
    }
  }

  async remove(blockId: string, userId: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const { taskId } = await tx.event.delete({
          where: { id: blockId, task: { userId } },
        });
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: { _count: { select: { events: true } } },
        });
        if (task?._count.events === 0) {
          await tx.task.delete({ where: { id: taskId } });
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException({
            success: false,
            message: `Cannot delete scheduled task because it does not exist`,
          });
      }

      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when trying to remove the schedule",
      });
    }
  }
}
