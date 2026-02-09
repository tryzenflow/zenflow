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
import { addMinutes } from "date-fns";

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(
    { rrule, fixedWindow, scheduleDate, ...createTaskDto }: CreateTaskDto,
    userId: string,
    timezone: string,
  ) {
    try {
      const taskId = crypto.randomUUID();
      const newTask = await this.prisma.task.create({
        data: {
          id: taskId,
          ...createTaskDto,
          rrule,
          fixedWindow: fixedWindow
            ? {
                create: { start: fixedWindow.start, end: fixedWindow.end },
              }
            : undefined,
          userId,
          events: {
            create: scheduleDate
              ? {
                  id: `${scheduleDate}/0/${taskId}`,
                  splitIndex: 0,
                  start: fromZonedTime(`${scheduleDate}T23:59:59`, timezone),
                }
              : undefined,
          },
        },
        include: {
          fixedWindow: { select: { start: true, end: true } },
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
    userId: string,
    timezone: string,
    scheduleDate: string,
    keepManual: boolean,
    minTime: number,
  ) {
    const startDate = fromZonedTime(
      addMinutes(new Date(`${scheduleDate}T00:00:00`), minTime),
      timezone,
    );
    const endDate = fromZonedTime(
      new Date(`${scheduleDate}T23:59:59`),
      timezone,
    );
    console.log(startDate, endDate);
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        OR: [
          {
            events: {
              some: {
                start: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            },
          },
          { rrule: { not: null } },
        ],
      },
      include: {
        fixedWindow: true,
        events: keepManual
          ? {
              where: {
                start: {
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

  async findRecurringTasks(
    userId: string,
    timezone: string,
    dateRangeDto: DateRangeDto,
  ) {
    const startDate = fromZonedTime(`${dateRangeDto.start}T00:00:00`, timezone);
    const endDate = fromZonedTime(`${dateRangeDto.end}T23:59:59`, timezone);

    const tasks = await this.prisma.task.findMany({
      where: { userId, rrule: { not: null } },
      include: {
        fixedWindow: { select: { start: true, end: true } },
        category: { select: { id: true, name: true } },
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

  async findById(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id, userId },
    });

    return task;
  }

  async update(
    id: string,
    { categoryId, fixedWindow, ...updateTaskDto }: UpdateTaskDto,
    userId: string,
    timezone: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      try {
        const updated = await tx.task.update({
          where: { id, userId },
          data: {
            ...updateTaskDto,
            fixedWindow: {
              delete: fixedWindow === null ? {} : undefined,
              create: fixedWindow
                ? { start: fixedWindow.start, end: fixedWindow.end }
                : undefined,
            },
            category: categoryId
              ? { connect: { id: categoryId, userId } }
              : undefined,
          },
          include: {
            events: {
              select: { id: true, start: true, end: true },
              orderBy: { start: "asc" },
            },
            fixedWindow: { select: { start: true, end: true } },
          },
        });
        if (updateTaskDto.rrule) {
          await tx.event.deleteMany({
            where: {
              taskId: id,
              isDirty: false,
              start: { gte: fromZonedTime(new Date(), timezone) },
            },
          });
        }
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
    });
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
