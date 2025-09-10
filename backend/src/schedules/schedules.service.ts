import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { UpdateScheduleDto } from "./dto/update-schedule.dto";
import { ScheduleResponse } from "../scheduler/scheduler.service";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { minutesToUtc } from "../scheduler/utils";
import { FindSchedulesDto } from "./dto/find-schedules.dto";

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async create(date: Date, { schedules }: ScheduleResponse, timezone: string) {
    const saved = await this.prisma.schedule.createManyAndReturn({
      data: schedules.map((s) => ({
        taskId: s.taskId,
        split: s?.split ?? 0,
        start: minutesToUtc(date, s?.start ?? 0, timezone),
        end: minutesToUtc(date, s?.end ?? 0, timezone),
      })),
    });
    return saved;
  }

  async update(
    taskId: string,
    split: number,
    { start, end }: UpdateScheduleDto
  ) {
    if (start >= end)
      throw new BadRequestException(
        "Task start time must be less than its end time"
      );
    const existingSchedule = await this.prisma.schedule.findUnique({
      where: { taskId_split: { taskId, split } },
    });
    if (!existingSchedule) throw new NotFoundException();

    const updated = await this.prisma.schedule.update({
      where: { taskId_split: { split, taskId } },
      data: {
        start,
        end,
      },
    });
    return updated;
  }

  async findSchedules({ start, end }: FindSchedulesDto) {
    const startDate = start ? new Date(start) : undefined;
    const endDate = end ? new Date(end) : undefined;
    const rangeSchedules = await this.prisma.schedule.findMany({
      where: {
        start: { gte: startDate, lt: endDate },
        end: { gte: startDate, lt: endDate },
      },
      include: {
        task: { select: { title: true } },
      },
      orderBy: { start: "asc" },
    });
    return rangeSchedules;
  }

  async remove(taskId: string, split: number) {
    try {
      await this.prisma.schedule.delete({
        where: { taskId_split: { split, taskId } },
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
