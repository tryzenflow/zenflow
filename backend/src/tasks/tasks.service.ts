import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { Prisma, Task } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { validateTaskFields } from "./validators/task-fields";
import { ScheduleTasksDto } from "../scheduler/dto/schedule-tasks.dto";
import { FindSchedulesDto } from "../schedules/dto/find-schedules.dto";
import { RRule } from "rrule";
import { endOfDay, startOfDay } from "date-fns";

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(
    {
      prerequisites = [],
      rrule,
      scheduleDate,
      ...createTaskDto
    }: CreateTaskDto,
    userId: string
  ) {
    const errors = validateTaskFields({ prerequisites, ...createTaskDto });
    if (errors.length > 0) {
      throw new BadRequestException({ success: false, message: errors });
    }
    try {
      const newTask = await this.prisma.task.create({
        data: {
          ...createTaskDto,
          rrule,
          prerequisites: { connect: prerequisites.map((p) => ({ id: p })) },
          userId,
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

  async find(userId: string, { start, end }: FindSchedulesDto) {
    const startDate = startOfDay(new Date(start));
    const endDate = startOfDay(new Date(end));
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        OR: [
          { rrule: { not: null } },
          { schedules: { some: { date: { gte: startDate, lt: endDate } } } },
        ],
      },
      include: {
        prerequisites: true,
        category: true,
        schedules: {
          where: { date: { gte: startDate, lt: endDate } },
        },
      },
    });
    return this.filterRecurringTasks(tasks, startDate, endDate);
  }

  async findUnscheduled(userId: string, { start, end }: FindSchedulesDto) {
    const startDate = startOfDay(new Date(start));
    const endDate = startOfDay(new Date(end));

    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        OR: [
          { rrule: { not: null } },
          {
            schedules: {
              none: {
                date: { gte: startDate, lt: endDate },
              },
            },
          },
        ],
      },
      include: {
        prerequisites: true,
        category: true,
      },
      orderBy: [{ createdAt: "desc" }, { schedules: { _count: "desc" } }],
    });

    return this.filterRecurringTasks(tasks, startDate, endDate, true);
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

  async findToSchedule({ scheduleDate }: ScheduleTasksDto, userId: string) {
    const date = startOfDay(new Date(scheduleDate));
    const endDate = endOfDay(date);
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        OR: [{ rrule: { not: null } }, { schedules: { some: { date } } }],
      },
      include: {
        schedules: { where: { date } },
        category: { select: { id: true } },
        prerequisites: { select: { id: true } },
      },
    });

    return this.filterRecurringTasks(tasks, date, endDate) as typeof tasks;
  }

  async update(
    id: string,
    {
      prerequisites,
      categoryId,
      rrule,
      scheduleDate,
      ...updateTaskDto
    }: UpdateTaskDto,
    userId: string
  ) {
    try {
      const errors = validateTaskFields({
        prerequisites,
        categoryId,
        ...updateTaskDto,
      });
      if (errors.length > 0) throw new BadRequestException(errors);
      const updated = await this.prisma.task.update({
        where: { id, userId },
        data: {
          ...updateTaskDto,
          rrule,
          category: categoryId ? { connect: { id: categoryId } } : undefined,
          schedules: {
            deleteMany: {},
            create: scheduleDate
              ? { date: new Date(scheduleDate), split: 0 }
              : undefined,
          },
          prerequisites: prerequisites
            ? { set: prerequisites?.map((p) => ({ id: p })) }
            : undefined,
        },
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
    tasks: Task[],
    startDate: Date,
    endDate: Date,
    complement: boolean = false
  ) {
    return tasks.filter((t) => {
      if (!t.rrule) return true;
      const rule = RRule.fromString(t.rrule);

      const matches = rule.between(startDate, endDate, true);
      return complement ? matches.length === 0 : matches.length > 0;
    });
  }
}
