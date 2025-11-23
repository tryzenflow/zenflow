import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { Prisma, Schedule, Task } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { validateTaskFields } from "./validators/task-fields";
import { FindSchedulesDto } from "../schedules/dto/find-schedules.dto";
import { RRule } from "rrule";
import { endOfDay, startOfDay } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(
    {
      prerequisites = [],
      rrule,
      scheduleDate,
      deadlineDate,
      deadlineTime,
      ...createTaskDto
    }: CreateTaskDto,
    userId: string,
    timezone: string
  ) {
    const errors = validateTaskFields({ prerequisites, ...createTaskDto });
    if (errors.length > 0) {
      throw new BadRequestException({ success: false, message: errors });
    }

    let deadline: Date | undefined;
    if (deadlineDate) {
      const timePart = deadlineTime ?? "23:59:59";
      const localDeadlineStr = `${deadlineDate}T${timePart}`;

      // Convert from user's timezone to UTC
      deadline = fromZonedTime(localDeadlineStr, timezone);
    }

    try {
      const newTask = await this.prisma.task.create({
        data: {
          ...createTaskDto,
          rrule,
          prerequisites: { connect: prerequisites.map((p) => ({ id: p })) },
          userId,
          deadline,
          schedules: scheduleDate
            ? {
                create: {
                  date: new Date(scheduleDate),
                  split: 0,
                },
              }
            : undefined,
        },
      });
      return newTask;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.ForeignViolation)
          throw new BadRequestException(
            "Cannot create task because its associated user, category, prerequisites may not exist"
          );
      }

      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when creating a task",
      });
    }
  }

  async find(
    userId: string,
    { start, end }: FindSchedulesDto,
    timezone: string
  ) {
    const startInTz = new Date(`${start}T00:00:00`);
    const endInTz = new Date(`${end}T00:00:00`);
    const startDate = fromZonedTime(startOfDay(startInTz), timezone);
    const endDate = fromZonedTime(endOfDay(endInTz), timezone);
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        schedules: { some: { date: { gt: startDate, lte: endDate } } },
      },
      include: {
        prerequisites: true,
        category: true,
        schedules: {
          where: { date: { gte: startDate, lte: endDate } },
        },
      },
    });
    return tasks;
  }

  async findUnscheduled(
    userId: string,
    { start, end }: FindSchedulesDto,
    timezone: string
  ) {
    const startInTz = new Date(`${start}T00:00:00`);
    const endInTz = new Date(`${end}T00:00:00`);
    const startDate = fromZonedTime(startOfDay(startInTz), timezone);
    const endDate = fromZonedTime(endOfDay(endInTz), timezone);

    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        schedules: {
          none: { date: { gt: startDate, lte: endDate } },
        },
      },
      include: {
        prerequisites: true,
        category: true,
      },
      orderBy: [{ createdAt: "desc" }, { schedules: { _count: "desc" } }],
    });

    return tasks;
  }

  async findById(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id, userId },
      include: {
        category: true,
        prerequisites: true,
      },
    });
    if (!task)
      throw new NotFoundException({
        success: false,
        message: `Cannot find task with id ${id}`,
      });
    return task;
  }

  async findToSchedule(scheduleDate: string, userId: string) {
    const date = new Date(scheduleDate);
    const tasks = await this.prisma.task.findMany({
      where: { userId, schedules: { some: { date } } },
      include: {
        schedules: { where: { date } },
        category: { select: { id: true } },
        prerequisites: { select: { id: true } },
      },
    });

    return tasks;
  }

  async update(
    id: string,
    {
      deadlineTime,
      deadlineDate,
      prerequisites,
      categoryId,
      rrule,
      scheduleDate,
      ...updateTaskDto
    }: UpdateTaskDto,
    userId: string,
    timezone: string
  ) {
    try {
      const errors = validateTaskFields({
        prerequisites,
        categoryId,
        ...updateTaskDto,
      });

      if (errors.length > 0) throw new BadRequestException(errors);
      let deadline: Date | undefined;
      if (deadlineDate) {
        const timePart = deadlineTime ?? "23:59:59";
        const localDeadlineStr = `${deadlineDate}T${timePart}`;

        // Convert from user's timezone to UTC
        deadline = fromZonedTime(localDeadlineStr, timezone);
      }

      const updated = await this.prisma.task.update({
        where: { id, userId },
        data: {
          ...updateTaskDto,
          rrule,
          deadline,
          category: categoryId ? { connect: { id: categoryId } } : undefined,
          schedules: {
            create: scheduleDate
              ? { date: new Date(scheduleDate), split: 0 }
              : undefined,
          },
          prerequisites: prerequisites
            ? { set: prerequisites?.map((p) => ({ id: p })) }
            : undefined,
        },
        include: { schedules: true },
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.UniqueConstraintViolation) {
          throw new BadRequestException({
            success: false,
            message: `Duplicate schedule date: ${scheduleDate}`,
          });
        }
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException({
            success: false,
            message: `Cannot find task with id ${id}`,
          });
        if (error.code === PostgresErrorCode.ForeignViolation)
          throw new BadRequestException({
            success: false,
            message:
              "Cannot update task because its associated category or prerequisites may not exist",
          });
      }
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when updating a task",
      });
    }
  }

  async remove(id: string, userId: string) {
    try {
      await this.prisma.task.delete({
        where: { id, userId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException({
            success: false,
            message: `Cannot find task with id ${id}`,
          });
      }
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when deleting a task",
      });
    }
  }

  private filterRecurringTasks(
    tasks: (Task & { schedules?: Schedule[] })[],
    startDate: Date,
    endDate: Date,
    complement: boolean = false
  ) {
    return tasks.filter((t) => {
      const hasEmptySlot =
        t.schedules && t.schedules.some((t) => !t.start || !t.end);

      if (!t.rrule || hasEmptySlot) return true;
      const rule = RRule.fromString(t.rrule);

      const matches = rule.between(startDate, endDate, true);
      return complement ? matches.length === 0 : matches.length > 0;
    });
  }
}
