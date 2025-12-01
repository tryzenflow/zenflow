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
    timezone: string,
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
          schedules:
            scheduleDate && !rrule
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
            "Cannot create task because its associated user, category, prerequisites may not exist",
          );
      }

      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when creating a task",
      });
    }
  }

  async find(userId: string, { start, end }: FindSchedulesDto) {
    // Get task ids that have schedules in the calendar-range using EXISTS (no duplicates).
    const idsRows = await this.prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT t.id
      FROM "Task" t
      WHERE t."userId" = ${userId}
        AND EXISTS (
          SELECT 1 FROM "Schedule" s
          WHERE s."taskId" = t.id
            AND s.date BETWEEN ${start}::date AND ${end}::date
        )
      ORDER BY t."createdAt" DESC;`;

    const taskIds = idsRows.map((r) => r.id);
    if (taskIds.length === 0) return [];

    // Fetch full task objects with relations
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      include: {
        prerequisites: true,
        category: true,
      },
      orderBy: [{ createdAt: "desc" }],
    });

    // Fetch schedules for those tasks in the same calendar-range (date-only comparison)
    const schedulesRows = await this.prisma.$queryRaw<
      Array<{
        taskId: string;
        date: string;
        start: Date | null;
        end: Date | null;
        split: number;
      }>
    >`SELECT s."taskId" AS "taskId", s.date::text AS date, s.start, s."end" AS "end", s.split
      FROM "Schedule" s
      WHERE s."taskId" = ANY(${taskIds})
        AND s.date BETWEEN ${start}::date AND ${end}::date
      ORDER BY s.date, s.start NULLS FIRST, s.split;`;

    // Group schedules by taskId
    const schedulesByTask = new Map<
      string,
      Array<{
        date: string;
        start: Date | null;
        end: Date | null;
        split: number;
      }>
    >();
    for (const r of schedulesRows) {
      const arr = schedulesByTask.get(r.taskId) ?? [];
      arr.push({
        date: r.date,
        start: r.start ?? null,
        end: r.end ?? null,
        split: r.split,
      });
      schedulesByTask.set(r.taskId, arr);
    }

    // Attach schedules to tasks and return same shape as original method
    const result = tasks.map((t) => {
      const schedules = (schedulesByTask.get(t.id) ?? []).map((s) => ({
        date: s.date ? new Date(`${s.date}T00:00:00Z`).toISOString() : null,
        start: s.start ? new Date(s.start).toISOString() : null,
        end: s.end ? new Date(s.end).toISOString() : null,
        split: s.split,
      }));

      return {
        ...t,
        schedules,
      };
    });

    return result;
  }

  /**
   * Find tasks that do not have a schedule between start and end (calendar days).
   * Returns an object with recurring (rrule-based occurrences in range) and
   * unscheduled lists (subject to filterRecurringTasks).
   */
  async findUnscheduled(
    userId: string,
    { start, end }: FindSchedulesDto,
    timezone: string,
  ) {
    // Use raw to get task ids that do NOT have schedules between the two dates
    const idsRows = await this.prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT t.id
       FROM "Task" t
       WHERE t."userId" = ${userId}
         AND NOT EXISTS (
           SELECT 1 FROM "Schedule" s
           WHERE s."taskId" = t.id
             AND s.date BETWEEN ${start}::date AND ${end}::date
         )
       ORDER BY t."createdAt" DESC;`;

    const taskIds = idsRows.map((r) => r.id);
    if (taskIds.length === 0) {
      return { recurring: [], unscheduled: [] };
    }

    // Fetch tasks with relations using Prisma so we get the same shapes (prereqs/category)
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      include: {
        prerequisites: { select: { id: true } },
        category: true,
      },
      // keep order by createdAt desc similar to the raw query ordering
      orderBy: [{ createdAt: "desc" }],
    });

    // For recurrence checks we need instants that cover the user's local day
    const startInstant = fromZonedTime(`${start}T00:00:00`, timezone);
    const endInstant = fromZonedTime(`${end}T23:59:59.999`, timezone);

    // We do not load schedules here (they are known to be none in the date range).
    const tasksWithEmptySchedules = tasks.map((t) => ({ ...t, schedules: [] }));

    return {
      recurring: this.filterRecurringTasks(
        tasksWithEmptySchedules.filter((t) => t.rrule),
        startInstant,
        endInstant,
      ) as typeof tasksWithEmptySchedules,
      unscheduled: this.filterRecurringTasks(
        tasksWithEmptySchedules,
        startInstant,
        endInstant,
        true,
      ) as typeof tasksWithEmptySchedules,
    };
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

  async findToSchedule(scheduleDate: string, userId: string, timezone: string) {
    // Get task ids that either have an rrule or have a schedule on that date
    const idsRows = await this.prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT DISTINCT t.id
       FROM "Task" t
       LEFT JOIN "Schedule" s ON s."taskId" = t.id
       WHERE t."userId" = ${userId}
         AND (t.rrule IS NOT NULL OR s.date BETWEEN ${scheduleDate}::date AND ${scheduleDate}::date);`;

    const taskIds = idsRows.map((r) => r.id);
    if (taskIds.length === 0) return [];

    // Fetch tasks with includes
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      include: {
        schedules: {
          where: {
            date: {
              gte: new Date(`${scheduleDate}T00:00:00Z`),
              lte: new Date(`${scheduleDate}T23:59:59Z`),
            },
          }, // this include is less important; main filtering is done via raw
        },
        category: { select: { id: true } },
        prerequisites: { select: { id: true } },
      },
    });

    // For rrule checks we need the day instants in UTC
    const startInstant = fromZonedTime(`${scheduleDate}T00:00:00`, timezone);
    const endInstant = fromZonedTime(`${scheduleDate}T23:59:59.999`, timezone);

    // Use filterRecurringTasks to remove recurring tasks that don't have an occurrence in that day
    return this.filterRecurringTasks(
      tasks,
      startInstant,
      endInstant,
    ) as typeof tasks;
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
    timezone: string,
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
            create:
              scheduleDate && !rrule
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
    tasks: (Task & { schedules: Schedule[] })[],
    startDate: Date,
    endDate: Date,
    complement: boolean = false,
  ) {
    return tasks.filter((t) => {
      if (!t.rrule) return true;
      const rule = RRule.fromString(t.rrule);

      const matches = rule.between(startDate, endDate, true);
      return complement ? matches.length === 0 : matches.length > 0;
    });
  }
}
