import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { DateRangeDto } from "../common/dto/date-range.dto";
import { fromZonedTime } from "date-fns-tz";
import { filterRecurringTasks } from "./utils/filter-recurring-tasks";

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(
    { rrule, fixedWindow, preferredWindows, ...createTaskDto }: CreateTaskDto,
    userId: string,
  ) {
    try {
      const newTask = await this.prisma.task.create({
        data: {
          ...createTaskDto,
          rrule,
          fixedWindow: fixedWindow
            ? {
                create: { start: fixedWindow.start, end: fixedWindow.end },
              }
            : undefined,
          preferredWindows: {
            createMany: {
              data:
                preferredWindows?.map((w) => ({
                  start: w.start,
                  end: w.end,
                })) || [],
            },
          },
          userId,
        },
        include: {
          fixedWindow: { select: { start: true, end: true } },
          preferredWindows: {
            select: { start: true, end: true },
            orderBy: { start: "asc" },
          },
        },
      });
      return newTask;
    } catch (error) {
      console.error(error);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.ForeignViolation)
          throw new BadRequestException(
            "Cannot create task because its associated user, category may not exist",
          );
      }

      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when creating a task",
      });
    }
  }

  async findToSchedule(
    taskIds: string[],
    userId: string,
    date: string,
    timezone: string,
    includeScheduledBlocks = false,
  ) {
    const startDate = fromZonedTime(new Date(`${date}T00:00:00`), timezone);
    const endDate = fromZonedTime(new Date(`${date}T23:59:59`), timezone);
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        OR: [{ id: { in: taskIds } }, { rrule: { not: null } }],
      },
      include: {
        fixedWindow: true,
        preferredWindows: true,
        scheduledBlocks: includeScheduledBlocks
          ? {
              where: {
                start: {
                  gte: startDate,
                  lte: endDate,
                },
                end: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            }
          : undefined,
      },
    });

    return filterRecurringTasks(
      tasks,
      startDate,
      endDate,
      false,
      timezone,
    ) as typeof tasks;
  }

  async find(userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        deadline: true,
        createdAt: true,
        duration: true,
        priority: true,
        energy: true,
        fixedWindow: true,
        preferredWindows: {
          select: { start: true, end: true },
          orderBy: { start: "asc" },
        },
        category: true,
        rrule: true,
        user: { select: { id: true, name: true } },
      },
    });

    return tasks;
  }

  async findUnscheduled(
    userId: string,
    { start, end }: DateRangeDto,
    timezone: string,
  ) {
    const startDate = fromZonedTime(new Date(`${start}T00:00:00`), timezone);
    const endDate = fromZonedTime(new Date(`${end}T23:59:59`), timezone);

    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        OR: [
          { rrule: { not: null } },
          {
            scheduledBlocks: {
              none: {
                start: {
                  gte: startDate,
                  lte: endDate,
                },
                end: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        deadline: true,
        createdAt: true,
        duration: true,
        priority: true,
        energy: true,
        fixedWindow: true,
        preferredWindows: {
          select: { start: true, end: true },
          orderBy: { start: "asc" },
        },
        category: true,
        rrule: true,
        user: { select: { id: true, name: true } },
      },
    });

    return filterRecurringTasks(tasks, startDate, endDate, true, timezone);
  }

  async findById(
    id: string,
    userId: string,
    { start, end }: DateRangeDto,
    timezone: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id, userId },
      include: {
        scheduledBlocks: {
          where: {
            start: {
              gte: fromZonedTime(new Date(`${start}T00:00:00`), timezone),
              lte: fromZonedTime(new Date(`${end}T23:59:59`), timezone),
            },
            end: {
              gte: fromZonedTime(new Date(`${start}T00:00:00`), timezone),
              lte: fromZonedTime(new Date(`${end}T23:59:59`), timezone),
            },
          },
        },
      },
    });

    return task;
  }

  async update(
    id: string,
    {
      categoryId,
      fixedWindow,
      preferredWindows,
      rrule,
      ...updateTaskDto
    }: UpdateTaskDto,
    userId: string,
  ) {
    try {
      const updated = await this.prisma.task.update({
        where: { id, userId },
        data: {
          ...updateTaskDto,
          rrule,
          fixedWindow: {
            delete: fixedWindow === null ? {} : undefined,
            create: fixedWindow
              ? { start: fixedWindow.start, end: fixedWindow.end }
              : undefined,
          },
          preferredWindows: preferredWindows
            ? {
                deleteMany: {},
                createMany: {
                  data:
                    preferredWindows.map((window) => ({
                      start: window.start,
                      end: window.end,
                    })) || [],
                },
              }
            : undefined,
          category: categoryId
            ? { connect: { id: categoryId, userId } }
            : undefined,
        },
        include: {
          scheduledBlocks: {
            select: { id: true, start: true, end: true },
            orderBy: { start: "asc" },
          },
          fixedWindow: { select: { start: true, end: true } },
          preferredWindows: { select: { start: true, end: true } },
        },
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
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
}
