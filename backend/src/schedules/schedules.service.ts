import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { fromZonedTime } from "date-fns-tz";
import { UpdateScheduleDto } from "./dto/update-schedule.dto";
import { ScheduleResponse } from "../scheduler/interfaces";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { minutesToUtc } from "../scheduler/utils";
import { FindSchedulesDto } from "./dto/find-schedules.dto";
import { extractDate } from "./utils";

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async create(date: Date, { schedules }: ScheduleResponse, timezone: string) {
    try {
      const saved = await this.prisma.schedule.createManyAndReturn({
        data: schedules.map((s) => ({
          date,
          taskId: s.taskId,
          split: s?.split ?? 0,
          start: minutesToUtc(date, s?.start ?? 0, timezone),
          end: minutesToUtc(date, s?.end ?? 0, timezone),
        })),
      });
      return saved;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.UniqueConstraintViolation) {
          throw new BadRequestException(
            `Duplicate tasks on date ${extractDate(date)}`
          );
        }
        throw new InternalServerErrorException();
      }
    }
  }

  async update(
    date: Date,
    taskId: string,
    split: number,
    { start, end }: UpdateScheduleDto
  ) {
    if (start >= end)
      throw new BadRequestException(
        "Task start time must be less than its end time"
      );
    const existingSchedule = await this.prisma.schedule.findUnique({
      where: { taskId_split_date: { taskId, split, date } },
    });
    if (!existingSchedule) throw new NotFoundException();

    const updated = await this.prisma.schedule.update({
      where: { taskId_split_date: { split, taskId, date } },
      data: { start, end },
    });
    return updated;
  }

  async findSchedules({ start, end }: FindSchedulesDto, timezone: string) {
    const startDate = fromZonedTime(`${start}T00:00:00`, timezone);
    const endDate = fromZonedTime(`${end}T00:00:00`, timezone);

    const rangeSchedules = await this.prisma.schedule.findMany({
      where: {
        start: { gte: startDate, lt: endDate },
        end: { gte: startDate, lt: endDate },
      },
      omit: { date: true },
      include: {
        task: { select: { title: true } },
      },
      orderBy: { start: "asc" },
    });
    return rangeSchedules;
  }

  async remove(date: Date, taskId: string, split: number) {
    try {
      await this.prisma.schedule.delete({
        where: { taskId_split_date: { split, taskId, date } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException();
      }
      throw new InternalServerErrorException();
    }
  }
}
