import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { fromZonedTime } from "date-fns-tz";
import { UpdateScheduleDto } from "./dto/update-schedule.dto";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { FindSchedulesDto } from "./dto/find-schedules.dto";
import { TaskSchedule } from "../scheduler/interfaces";
import { extractDate, minutesToUtc, minuteToTime } from "../common/utils";

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async schedule(
    date: Date,
    schedules: TaskSchedule[],
    timezone: string,
    userId: string
  ) {
    try {
      return this.prisma.$transaction(async (tx) => {
        await tx.schedule.deleteMany({
          where: { date, task: { userId } },
        });

        const saved = await tx.schedule.createManyAndReturn({
          data: schedules.map((s) => ({
            date,
            taskId: s.taskId,
            split: s?.split ?? 0,
            start: s.start ? minutesToUtc(date, s.start, timezone) : undefined,
            end: s.end ? minutesToUtc(date, s.end, timezone) : undefined,
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
            message: `Duplicate tasks on date ${extractDate(date)}`,
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
    date: Date,
    taskId: string,
    split: number,
    { start, end }: UpdateScheduleDto,
    userId: string
  ) {
    if (start >= end)
      throw new BadRequestException(
        "Task start time must be less than its end time"
      );
    const existingSchedule = await this.prisma.schedule.findUnique({
      where: { taskId_split_date: { taskId, split, date }, task: { userId } },
    });
    if (!existingSchedule) throw new NotFoundException();

    const updated = await this.prisma.schedule.update({
      where: { taskId_split_date: { split, taskId, date }, task: { userId } },
      data: { start, end },
    });
    return updated;
  }

  async findSchedules({ start, end }: FindSchedulesDto, userId: string) {
    const rangeSchedules = await this.prisma.schedule.findMany({
      where: {
        date: { gte: new Date(start), lt: new Date(end) },
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

  async remove(date: Date, taskId: string, split: number, userId: string) {
    try {
      await this.prisma.schedule.delete({
        where: { taskId_split_date: { split, taskId, date }, task: { userId } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException({
            success: false,
            message: `Cannot delete scheduled task split ${split} on ${extractDate(date)}`,
          });
      }
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when trying to remove the schedule",
      });
    }
  }
}
