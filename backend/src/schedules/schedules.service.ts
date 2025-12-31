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

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async schedule(
    date: string, // YYYY-MM-DD (local date)
    schedules: TaskSchedule[],
    timezone: string, // e.g. "Asia/Bangkok"
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      /**
       * 1. DELETE ALL schedules for this user on that local date
       *    (this is the critical part)
       */
      await tx.$executeRaw`
        DELETE FROM "Schedule" s
        USING "Task" t
        WHERE s."taskId" = t.id
          AND t."userId" = ${userId}
          AND s."date" = ${date}::date;
      `;

      if (schedules.length === 0) {
        // complete wipe requested
        return [];
      }

      /**
       * 2. Prepare rows (deduplicate input defensively)
       */
      const rows = Array.from(
        new Map(
          schedules.map((s) => {
            const split = s.split ?? 0;
            return [
              `${s.taskId}:${split}`,
              {
                date,
                taskId: s.taskId,
                split,
                start:
                  s.start !== undefined
                    ? minutesToUtc(date, s.start, timezone)
                    : null,
                end:
                  s.end !== undefined
                    ? minutesToUtc(date, s.end, timezone)
                    : null,
              },
            ];
          }),
        ).values(),
      );

      /**
       * 3. BULK INSERT (no conflict possible now)
       */
      const inserted = await tx.$queryRaw<
        Array<{
          date: string;
          start: Date | null;
          end: Date | null;
          split: number;
          taskId: string;
        }>
      >`
        INSERT INTO "Schedule" (date, "taskId", split, start, "end")
        SELECT
          r.date::date,
          r."taskId",
          r.split,
          r.start,
          r."end"
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
          AS r(
            date text,
            "taskId" uuid,
            split int,
            start timestamptz,
            "end" timestamptz
          )
        RETURNING
          date::text AS date,
          start,
          "end",
          split,
          "taskId";
      `;

      /**
       * 4. Fetch tasks
       */
      const taskIds = Array.from(new Set(inserted.map((r) => r.taskId)));

      const tasks = await tx.task.findMany({
        where: {
          id: { in: taskIds },
          userId,
        },
        select: {
          id: true,
          title: true,
          focus: true,
          duration: true,
        },
      });

      const taskMap = new Map(tasks.map((t) => [t.id, t]));

      /**
       * 5. Shape response
       */
      return inserted
        .map((r) => ({
          date: new Date(`${r.date}T00:00:00Z`).toISOString(),
          start: r.start ? new Date(r.start).toISOString() : null,
          end: r.end ? new Date(r.end).toISOString() : null,
          split: r.split,
          task: taskMap.get(r.taskId) ?? {
            id: r.taskId,
            title: "",
            focus: 1,
            duration: 0,
          },
        }))
        .sort((a, b) => {
          const aTime = a.start ? Date.parse(a.start) : 0;
          const bTime = b.start ? Date.parse(b.start) : 0;
          return aTime - bTime;
        });
    });
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
