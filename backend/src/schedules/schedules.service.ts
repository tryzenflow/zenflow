import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
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

  /**
   * Replace schedules for a calendar date for the given user and insert provided schedules.
   * - `date` is a 'YYYY-MM-DD' string representing a calendar day in the user's timezone.
   * - The delete and inserts use DB-side DATE comparisons so Postgres stores the calendar date exactly.
   */
  async schedule(
    date: string,
    schedules: TaskSchedule[],
    timezone: string,
    userId: string,
  ) {
    try {
      const results = await this.prisma.$transaction(async (tx) => {
        // Delete existing schedules for this user's tasks on that calendar date.
        await tx.$executeRaw`DELETE FROM "Schedule" s
           USING "Task" t
           WHERE s."taskId" = t.id
             AND t."userId" = ${userId}
             AND s.date = ${date}::date;`;

        // Insert each schedule row using raw INSERT ... RETURNING so date is stored as DATE
        const insertedRows: Array<{
          date: string;
          start: Date | null;
          end: Date | null;
          split: number;
          taskId: string;
        }> = [];

        for (const s of schedules) {
          const split = s?.split ?? 0;
          const utcStart =
            s.start !== undefined
              ? minutesToUtc(date, s.start, timezone)
              : null;
          const utcEnd =
            s.end !== undefined ? minutesToUtc(date, s.end, timezone) : null;

          const rows = await tx.$queryRaw<
            Array<{
              date: string;
              start: Date | null;
              end: Date | null;
              split: number;
              taskId: string;
            }>
          >`INSERT INTO "Schedule" (date, "taskId", split, start, "end")
             VALUES (${date}::date, ${s.taskId}, ${split}, ${utcStart}, ${utcEnd})
             RETURNING date::text AS date, start, "end", split, "taskId";`;

          if (rows && rows.length > 0) insertedRows.push(rows[0]);
        }

        if (insertedRows.length === 0) return [];

        // Fetch tasks for the inserted taskIds to build the same shape your API expects
        const uniqueTaskIds = Array.from(
          new Set(insertedRows.map((r) => r.taskId)),
        );

        const tasks = await tx.task.findMany({
          where: { id: { in: uniqueTaskIds } },
          select: { id: true, title: true, focus: true, duration: true },
        });
        const taskMap = new Map(tasks.map((t) => [t.id, t]));

        // Map inserted rows to desired output shape
        const saved = insertedRows.map((r) => ({
          date: r.date ? new Date(`${r.date}T00:00:00Z`).toISOString() : null,
          start: r.start ? new Date(r.start).toISOString() : null,
          end: r.end ? new Date(r.end).toISOString() : null,
          split: r.split,
          task: taskMap.get(r.taskId) ?? {
            id: r.taskId,
            title: "",
            focus: 1,
            duration: 0,
          },
        }));

        saved.sort((a, b) => {
          const aTime = a?.start ? new Date(a.start).getTime() : 0;
          const bTime = b?.start ? new Date(b.start).getTime() : 0;
          return aTime - bTime;
        });

        return saved;
      });

      return results;
    } catch (error) {
      console.log(error);
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
      // rethrow other errors
      throw error;
    }
  }

  async update(
    date: string,
    taskId: string,
    split: number,
    { start, end }: UpdateScheduleDto,
    userId: string,
    timezone: string,
  ) {
    if (start >= end)
      throw new BadRequestException({
        success: false,
        message: "Task start time must be less than its end time",
      });

    // Verify schedule exists and belongs to the user
    const existing = await this.prisma.$queryRaw<
      Array<{ date: string }>
    >`SELECT 1 FROM "Schedule" s
       JOIN "Task" t ON s."taskId" = t.id
       WHERE s."taskId" = ${taskId}
         AND s.split = ${split}
         AND s.date = ${date}::date
         AND t."userId" = ${userId}
       LIMIT 1;`;

    if (!existing || existing.length === 0) throw new NotFoundException();

    const utcStart = minutesToUtc(date, start, timezone);
    const utcEnd = minutesToUtc(date, end, timezone);

    const rows = await this.prisma.$queryRaw<
      Array<{
        date: string;
        start: Date | null;
        end: Date | null;
        split: number;
        taskId: string;
      }>
    >`UPDATE "Schedule"
       SET start = ${utcStart}, "end" = ${utcEnd}
       WHERE "taskId" = ${taskId} AND split = ${split} AND date = ${date}::date
       RETURNING date::text AS date, start, "end", split, "taskId";`;

    if (!rows || rows.length === 0) throw new NotFoundException();

    const r = rows[0];
    return {
      date: r.date ? new Date(`${r.date}T00:00:00Z`).toISOString() : null,
      start: r.start ? new Date(r.start).toISOString() : null,
      end: r.end ? new Date(r.end).toISOString() : null,
      split: r.split,
      taskId: r.taskId,
    };
  }

  /**
   * Find schedules between two calendar dates (inclusive) for a user.
   * Uses DB DATE comparison to avoid timezone/instant mismatches.
   */
  async findSchedules({ start, end }: FindSchedulesDto, userId: string) {
    // Raw query: compare DATE types in DB directly
    const rows = await this.prisma.$queryRaw<
      Array<{
        date: string;
        start: Date | null;
        end: Date | null;
        split: number;
        task: {
          id: string;
          title: string;
          focus: number;
          duration: number;
          rrule: string | null;
        };
      }>
    >`SELECT
        s.date::text AS date,
        s.start,
        s."end" AS "end",
        s.split,
        json_build_object(
          'id', t.id,
          'title', t.title,
          'focus', t.focus,
          'duration', t.duration,
          'rrule', t.rrule
        ) AS task
      FROM "Schedule" s
      JOIN "Task" t ON s."taskId" = t.id
      WHERE t."userId" = ${userId}
        AND s.date BETWEEN ${start}::date AND ${end}::date
      ORDER BY s.start NULLS FIRST, s.split;`;

    // Normalize to the same shape the rest of the API expects
    return rows.map((r) => ({
      date: r.date ? new Date(`${r.date}T00:00:00Z`).toISOString() : null,
      start: r.start ? new Date(r.start).toISOString() : null,
      end: r.end ? new Date(r.end).toISOString() : null,
      split: r.split,
      task: r.task,
    }));
  }

  async remove(date: string, taskId: string, split: number, userId: string) {
    try {
      const result = await this.prisma.$executeRaw`DELETE FROM "Schedule" s
          USING "Task" t
          WHERE s."taskId" = t.id
            AND t."userId" = ${userId}
            AND s."taskId" = ${taskId}
            AND s.split = ${split}
            AND s.date = ${date}::date;`;

      // $executeRaw returns the number of rows affected in newer Prisma versions.
      // If zero rows deleted, treat as not found.
      if ((result as any) === 0) {
        throw new NotFoundException({
          success: false,
          message: `Cannot delete scheduled task split ${split} on ${date}`,
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException({
            success: false,
            message: `Cannot delete scheduled task split ${split} on ${date}`,
          });
      }
      // If it's already a NotFoundException, rethrow it
      if (error instanceof NotFoundException) throw error;

      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when trying to remove the schedule",
      });
    }
  }
}
