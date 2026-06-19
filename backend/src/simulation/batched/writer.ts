import { Logger } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PersonaState } from "./engine";

/**
 * Bulk persistence for the batched simulator. The engine computes a year of
 * telemetry in memory; this flushes it to the sim DB in large `createMany`
 * batches (50k rows) instead of per-row writes. FK order is respected — users →
 * tags → tasks → the implicit `_TagToTask` join → events — and the implicit
 * many-to-many join (which `createMany` can't express) is written with a chunked
 * raw INSERT. All ids are UUIDs minted in memory, so the rows are self-consistent
 * before they ever touch the database.
 */

const CHUNK = 50_000;
/** Join-row chunk: 2 cols/row, kept well under Postgres' identifier/row limits. */
const JOIN_CHUNK = 20_000;

const logger = new Logger("sim:writer");

/** The User columns the simulator seeds (the rest take Prisma defaults). */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  timezone: string;
  workStart: number;
  workEnd: number;
  workDays: number[];
  onboardingComplete: boolean;
  roleArchetypeId: string | null;
}

export interface PersonaOutput {
  user: UserRecord;
  state: PersonaState;
}

async function inChunks<T>(
  rows: T[],
  size: number,
  fn: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

/** Flush every persona's users/tags/tasks/joins/events to the DB in batches. */
export async function bulkWrite(
  prisma: PrismaService,
  outputs: PersonaOutput[],
): Promise<{ users: number; tags: number; tasks: number; events: number }> {
  // ── Users (carry the final accumulated preferenceMatrix) ──────────────────
  const userRows: Prisma.UserCreateManyInput[] = outputs.map((o) => ({
    id: o.user.id,
    name: o.user.name,
    email: o.user.email,
    timezone: o.user.timezone,
    workStart: o.user.workStart,
    workEnd: o.user.workEnd,
    workDays: o.user.workDays,
    onboardingComplete: o.user.onboardingComplete,
    roleArchetypeId: o.user.roleArchetypeId,
    preferenceMatrix: o.state.matrix,
  }));
  await inChunks(userRows, CHUNK, (batch) =>
    prisma.user.createMany({ data: batch, skipDuplicates: true }),
  );

  // ── Tags ──────────────────────────────────────────────────────────────────
  const tagRows: Prisma.TagCreateManyInput[] = outputs.flatMap((o) =>
    o.state.tagRows().map((t) => ({
      id: t.id,
      name: t.name,
      userId: o.user.id,
    })),
  );
  await inChunks(tagRows, CHUNK, (batch) =>
    prisma.tag.createMany({ data: batch, skipDuplicates: true }),
  );

  // ── Tasks ───────────────────────────────────────────────────────────────
  const taskRows: Prisma.TaskCreateManyInput[] = outputs.flatMap((o) =>
    o.state.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      note: t.note,
      durationMinutes: t.durationMinutes,
      deadline: t.deadline,
      fixed: t.fixed,
      startTime: t.startTime,
      status: t.status,
      conflict: t.conflict,
      manuallyMoved: t.manuallyMoved,
      schedulingAnchor: t.schedulingAnchor,
      scheduledStartTime: t.scheduledStartTime,
      view: t.view,
      userId: t.userId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  );
  await inChunks(taskRows, CHUNK, (batch) =>
    prisma.task.createMany({ data: batch, skipDuplicates: true }),
  );

  // ── Implicit M2M join (_TagToTask: A=Tag.id, B=Task.id) via raw INSERT ──────
  const joinRows: [string, string][] = outputs.flatMap((o) =>
    o.state.tasks.flatMap((t) =>
      t.tagIds.map((tagId) => [tagId, t.id] as [string, string]),
    ),
  );
  await inChunks(joinRows, JOIN_CHUNK, (batch) => {
    const values = batch.map(([a, b]) => `('${a}','${b}')`).join(",");
    return prisma.$executeRawUnsafe(
      `INSERT INTO "_TagToTask" ("A","B") VALUES ${values} ON CONFLICT DO NOTHING`,
    );
  });

  // ── TaskEvents (BigInt id auto-assigned) ────────────────────────────────────
  const eventRows: Prisma.TaskEventCreateManyInput[] = outputs.flatMap((o) =>
    o.state.events.map((e) => ({
      eventType: e.eventType,
      oldSnapshot: e.oldSnapshot === null ? Prisma.JsonNull : e.oldSnapshot,
      newSnapshot: e.newSnapshot,
      rewardScore: e.rewardScore,
      occurredAt: e.occurredAt,
      taskId: e.taskId,
      userId: e.userId,
    })),
  );
  await inChunks(eventRows, CHUNK, (batch) =>
    prisma.taskEvent.createMany({ data: batch }),
  );

  logger.log(
    `Wrote ${userRows.length} users, ${tagRows.length} tags, ${taskRows.length} tasks, ${joinRows.length} tag-links, ${eventRows.length} events`,
  );
  return {
    users: userRows.length,
    tags: tagRows.length,
    tasks: taskRows.length,
    events: eventRows.length,
  };
}
