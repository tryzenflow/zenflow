import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { endOfDay, startOfDay } from "date-fns";
import { Prisma } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { TaskSchedule } from "../scheduler/interfaces";
import { FindSchedulesDto } from "./dto/find-schedules.dto";
import { UpdateScheduleDto } from "./dto/update-schedule.dto";
import { fromZonedTime } from "date-fns-tz";

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async schedule(
    date: string,
    schedules: TaskSchedule[],
    timezone: string,
    userId: string
  ) {
    try {
      return this.prisma.$transaction(async (tx) => {
        await tx.schedule.deleteMany({
          where: { date: new Date(date), task: { userId } },
        });

        const saved = await tx.schedule.createManyAndReturn({
          data: schedules.map((s) => ({
            date: new Date(date),
            taskId: s.taskId,
            split: s?.split ?? 0,
            start:
              s.start !== undefined
                ? minutesToUtc(date, s.start, timezone)
                : undefined,
            end:
              s.end !== undefined
                ? minutesToUtc(date, s.end, timezone)
                : undefined,
          })),
          select: {
            date: true,
            end: true,
            split: true,
            start: true,
            task: {
              select: { id: true, title: true, focus: true, duration: true },
            },
          },
        });
        saved.sort((a, b) => {
          const aTime = a?.start ? a.start.getTime() : 0;
          const bTime = b?.start ? b.start.getTime() : 0;
          return aTime - bTime;
        });
        return saved;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.UniqueConstraintViolation) {
          throw new BadRequestException({
            success: false,
            message: `Duplicate tasks on date ${date}`,
          });
        }
        throw new InternalServerErrorException({
          success: false,
          message: "Server error when scheduling tasks",
        });
      }
    }
  }

  async update(
    date: string,
    taskId: string,
    split: number,
    { start, end }: UpdateScheduleDto,
    userId: string,
    timezone: string
  ) {
    if (start >= end)
      throw new BadRequestException({
        success: false,
        message: "Task start time must be less than its end time",
      });
    const existingSchedule = await this.prisma.schedule.findUnique({
      where: {
        taskId_split_date: { taskId, split, date: new Date(date) },
        task: { userId },
      },
    });
    if (!existingSchedule) throw new NotFoundException();

    // Convert start/end minutes → UTC Date
    const utcStart = minutesToUtc(date, start, timezone);
    const utcEnd = minutesToUtc(date, end, timezone);
    const updated = await this.prisma.schedule.update({
      where: {
        taskId_split_date: { split, taskId, date: new Date(date) },
        task: { userId },
      },
      data: { start: utcStart, end: utcEnd },
    });
    return updated;
  }

  async findSchedules(
    { start, end }: FindSchedulesDto,
    userId: string,
    timezone: string
  ) {
    const startDate = fromZonedTime(startOfDay(new Date(start)), timezone);
    const endDate = fromZonedTime(endOfDay(new Date(end)), timezone);

    const rangeSchedules = await this.prisma.schedule.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        task: { userId },
      },
      omit: { taskId: true },
      include: {
        task: {
          select: { id: true, title: true, focus: true, duration: true },
        },
      },
      orderBy: { start: "asc" },
    });
    return rangeSchedules;
  }

  async remove(date: string, taskId: string, split: number, userId: string) {
    try {
      await this.prisma.schedule.delete({
        where: {
          taskId_split_date: { split, taskId, date: new Date(date) },
          task: { userId },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException({
            success: false,
            message: `Cannot delete scheduled task split ${split} on ${date}`,
          });
      }
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when trying to remove the schedule",
      });
    }
  }
}
