import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  notificationCategory,
  type NotificationDto,
  type NotificationsListResponse,
} from "@zenflow/shared";
import {
  Prisma,
  type Notification,
  type SessionSource,
  type SessionType,
  type User,
} from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { ListNotificationsDto } from "./dto/list-notifications.dto";
import { NotificationEvent } from "./types";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import { localizeNotification } from "./localize-notification";
import { NotificationPubSub } from "./notification-pubsub.service";
import {
  queueEnqueueDropped,
  queueNotifyReconciled,
} from "../observability/metrics";
import { QueueService } from "../queue/queue.service";
import { NOTIFY_QUEUE, type PushProvider } from "../queue/queues";
import { idempotencyKey } from "../queue/queue.types";

const PUSH_PROVIDERS: readonly PushProvider[] = ["fcm", "apns"];

/** Delay before each enqueue attempt of {@link NotificationsService.announce}. */
const ENQUEUE_RETRY_DELAYS_MS = [0, 250, 1_000];
/** {@link NotificationsService.reconcileRecent}: rows from this window ... */
export const RECONCILE_WINDOW_MS = 2 * 60 * 60 * 1000;
/** ... that are at least this old ... */
export const RECONCILE_MIN_AGE_MS = 60_000;
/** ... at most this many per sweep. */
/** Rows checked per query; the sweep pages through the window in these. */
const RECONCILE_BATCH = 500;

/**
 * One of each inbox row style, cycled by {@link NotificationsService.raiseSamples}
 * for the dev-only test trigger.
 */
const DEV_SAMPLES: CreateNotificationInput[] = [
  {
    eventName: "assignment.created",
    title: "New assignment: Sorting Algorithms",
    content: "Plan it before it's due.",
    sessionId: null,
    eventEndsAt: null,
  },
  {
    eventName: "exam.created",
    title: "New exam: Midterm — Room A305",
    content: "Plan your revision now.",
    sessionId: null,
    eventEndsAt: null,
  },
  {
    eventName: "lecture.group_created",
    title: "12 new lectures",
    content: "Check your timetable.",
    sessionId: null,
    eventEndsAt: null,
  },
  {
    eventName: "lecture.updated",
    title: "Updated: Databases — Room B210",
    content: "See what changed.",
    sessionId: null,
    eventEndsAt: null,
  },
  {
    eventName: "lecture.removed",
    title: "Lectures removed: Data Structures Lab",
    content: "It's gone from your calendar.",
    sessionId: null,
    eventEndsAt: null,
    // A removal has nothing to attach to; don't synthesize a placeholder session.
    materializeSession: false,
  },
];

/** What the materializer passes to {@link NotificationsService.create}. */
export interface CreateNotificationInput {
  title: string;
  /**
   * Stable slug ("assignment.created", "lecture.removed", …); see
   * {@link NotificationDto.eventName}. Required, not optional, so a caller
   * can never silently mis-tag (or forget to tag) a row.
   */
  eventName: string;
  sessionId: string | null;
  content: string;
  /** Fixed end instant of the session behind the row, or null (groups/drops). */
  eventEndsAt: Date | null;
  /**
   * Whether {@link NotificationsService.create} may synthesize a placeholder
   * calendar session when the caller doesn't attach one (`sessionId: null`).
   * Defaults to `true`; callers raising a removal set this `false` since there
   * is nothing left to attach a session to.
   */
  materializeSession?: boolean;
}

/**
 * `eventName`'s category → (session type, source, default duration) used
 * whenever a notification auto-materializes a calendar session, in both
 * {@link NotificationsService.create} and {@link NotificationsService.raiseSamples}.
 */
function resolveSessionDefaults(eventName: string): {
  type: SessionType;
  source: SessionSource;
  durationMinutes: number;
} {
  switch (notificationCategory(eventName)) {
    case "EXAM":
      return { type: "EXAM", source: "PORTAL", durationMinutes: 120 };
    case "LECTURE":
      return { type: "LECTURE", source: "PORTAL", durationMinutes: 90 };
    case "ASSIGNMENT":
    case "REMINDER":
    default:
      return { type: "TASK", source: "LMS", durationMinutes: 90 };
  }
}

/** Strips the notification-title framing ("New assignment: ", "Updated: ") down to the underlying event/course title. */
function cleanNotificationTitle(title: string): string {
  return title
    .replace(/^New (assignment|exam): /i, "")
    .replace(/^Updated: /i, "")
    .trim();
}

/** Row → wire shape: instants become ISO-8601 strings, absences become `null`. */
function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    eventName: row.eventName,
    title: row.title,
    content: row.content,
    sentAt: row.sentAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    actionTakenAt: row.actionTakenAt ? row.actionTakenAt.toISOString() : null,
    eventEndsAt: row.eventEndsAt ? row.eventEndsAt.toISOString() : null,
    sessionId: row.sessionId,
    conflictSessionIds: row.conflictSessionIds ?? [],
  };
}

/**
 * The student's ingestion inbox.
 *
 * Rows are written by `ingestion/materializer.service.ts` when a watcher puts
 * something new (or newly changed) on the calendar; nothing here creates them.
 * The call to action is "plan work around this item", not "confirm this item" —
 * confirm/dismiss semantics belong to #31.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubsub: NotificationPubSub,
    private readonly queue: QueueService,
  ) {}

  /**
   * The process-local emitter `GET /notifications/stream` reads. Fed by
   * Redis pub/sub in every HTTP process (ADR-0018), so it also carries rows
   * raised by workers and other replicas.
   */
  get notificationEmitter(): EventEmitter2 {
    return this.pubsub.emitter;
  }

  /**
   * Announce a freshly created row, fire-and-forget: see {@link announce}.
   * Never fails the caller, whose row is already stored.
   */
  notify(event: string, payload: Notification): void {
    void this.announce(event, payload);
  }

  /**
   * Publish the row to every SSE-serving process and enqueue its push jobs
   * (one per provider, job id derived from the row id, so a repeat call or a
   * retry sends nothing twice). Each enqueue is retried briefly; one that
   * still fails is counted (`queue.enqueue.dropped`) and left for
   * {@link reconcileRecent}. Never rejects.
   *
   * Residual window: the row commits before the enqueue, so a process crash
   * between the two (or a queue outage longer than the sweep's
   * {@link RECONCILE_WINDOW_MS}) loses the push; closing it fully needs an
   * outbox column (a schema change). The sweep covers everything else.
   */
  async announce(event: string, payload: Notification): Promise<void> {
    await Promise.all([
      this.pubsub.publish(event, payload),
      ...PUSH_PROVIDERS.map((provider) =>
        this.enqueuePush(payload.id, provider),
      ),
    ]);
  }

  private async enqueuePush(
    notificationId: string,
    provider: PushProvider,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < ENQUEUE_RETRY_DELAYS_MS.length; attempt++) {
      const wait = ENQUEUE_RETRY_DELAYS_MS[attempt];
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const job = await this.queue.enqueueBestEffort(
        NOTIFY_QUEUE,
        { type: "push", notificationId, provider },
        { jobId: idempotencyKey("push", notificationId, provider) },
      );
      if (job) return true;
    }
    queueEnqueueDropped.add(1, { queue: NOTIFY_QUEUE.name, type: "push" });
    this.logger.warn(
      `push enqueue dropped for ${notificationId}/${provider}; the reconciliation sweep will retry`,
    );
    return false;
  }

  /**
   * Re-enqueue push jobs for recent rows that have none (their enqueue was
   * dropped). Job ids are deterministic, so an existing job (any state) is
   * left alone and a race with the normal path is a no-op. Run by the
   * watcher every few minutes. Rows younger than a minute are skipped (the
   * normal path is still running). Caveat: a finished job evicted by queue
   * retention (count cap) inside the window would be pushed again.
   * Returns how many jobs it re-enqueued.
   */
  async reconcileRecent(now = new Date()): Promise<number> {
    const where = {
      sentAt: {
        gte: new Date(now.getTime() - RECONCILE_WINDOW_MS),
        lte: new Date(now.getTime() - RECONCILE_MIN_AGE_MS),
      },
    };
    let repaired = 0;
    let cursor: string | undefined;
    // Page the whole window, newest first, so a burst larger than one batch
    // does not leave its older rows unchecked until they age out.
    for (;;) {
      const rows = await this.prisma.notification.findMany({
        where,
        select: { id: true },
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: RECONCILE_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const { id } of rows) {
        for (const provider of PUSH_PROVIDERS) {
          const jobId = idempotencyKey("push", id, provider);
          // Throws when the queue Redis is down: stop, the next sweep retries.
          if (await this.queue.getJob(NOTIFY_QUEUE, jobId)) continue;
          const job = await this.queue.enqueueBestEffort(
            NOTIFY_QUEUE,
            { type: "push", notificationId: id, provider },
            { jobId },
          );
          if (job) {
            repaired++;
            queueNotifyReconciled.add(1, { provider });
          }
        }
      }
      if (rows.length < RECONCILE_BATCH) return repaired;
      cursor = rows[rows.length - 1].id;
    }
  }

  toNotificationDto(payload: Notification): NotificationDto {
    return toNotificationDto(payload);
  }

  async create(
    userId: string,
    dto: CreateNotificationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Notification> {
    const db = tx ?? this.prisma;
    const recipient = await db.user?.findUnique({
      where: { id: userId },
      select: { lang: true },
    });
    const { materializeSession, ...notificationFields } = dto;
    let sessionId = dto.sessionId;
    let eventEndsAt = dto.eventEndsAt;

    // Automatically create a calendar session/task if none is attached and the
    // caller hasn't opted out (removals have nothing left to attach one to).
    if (!sessionId && materializeSession !== false && db?.session) {
      try {
        const { type, source, durationMinutes } = resolveSessionDefaults(
          dto.eventName,
        );
        const cleanTitle = cleanNotificationTitle(dto.title);

        const roomMatch = (dto.title + " " + dto.content).match(
          /(?:Room|Phòng)\s+([A-Za-z0-9-]+)/i,
        );
        const location = roomMatch ? roomMatch[0] : null;

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);

        let scheduledStartTime: Date = tomorrow;
        let deadline: Date | null = null;

        if (eventEndsAt) {
          scheduledStartTime = new Date(
            eventEndsAt.getTime() - durationMinutes * 60000,
          );
          if (type === "TASK" || type === "EXAM") {
            deadline = eventEndsAt;
          }
        } else {
          eventEndsAt = new Date(
            scheduledStartTime.getTime() + durationMinutes * 60000,
          );
          if (type === "TASK" || type === "EXAM") {
            deadline = eventEndsAt;
          }
        }

        const createdSession = await db.session.create({
          data: {
            userId,
            title: cleanTitle,
            type,
            source,
            location,
            durationMinutes,
            scheduledStartTime,
            deadline,
            note: dto.content,
          },
        });
        sessionId = createdSession.id;
      } catch (err) {
        console.warn("[notifications] Auto task creation failed:", err);
      }
    }

    const newNotification = await db.notification.create({
      data: {
        ...notificationFields,
        sessionId,
        eventEndsAt,
        userId,
      },
    });

    return localizeNotification(newNotification, recipient?.lang);
  }

  /**
   * Dev-only: write `count` fake rows (cycling {@link DEV_SAMPLES}) and emit
   * `NEW_SESSION` for each — exactly what the materializer does, so they reach
   * the SSE stream and the push queue. Called from `POST /notifications/dev/raise`
   * so the emit runs in the API process; a standalone script has its own
   * in-memory emitter with no listeners.
   */
  async raiseSamples(userId: string, count = 1): Promise<NotificationDto[]> {
    const n = Math.max(1, Math.min(20, count));
    const raised: NotificationDto[] = [];

    const now = new Date();
    // Schedule sample items starting from tomorrow
    const baseDate = new Date(now);
    baseDate.setMinutes(0, 0, 0);
    baseDate.setHours(baseDate.getHours() + 14);

    for (let i = 0; i < n; i++) {
      const sample = DEV_SAMPLES[i % DEV_SAMPLES.length];
      const sessionStart = new Date(
        baseDate.getTime() + i * 24 * 60 * 60 * 1000,
      );
      let sessionId: string | null = null;
      let eventEndsAt: Date | null = null;

      if (sample.materializeSession !== false) {
        const { type, source, durationMinutes } = resolveSessionDefaults(
          sample.eventName,
        );
        let title = cleanNotificationTitle(sample.title).replace(
          / \(#\d+\)$/,
          "",
        );
        let location: string | null = null;
        let deadline: Date | null = null;

        const category = notificationCategory(sample.eventName);
        if (category === "ASSIGNMENT") {
          deadline = new Date(sessionStart.getTime() + 4 * 60 * 60 * 1000);
          eventEndsAt = deadline;
        } else if (category === "EXAM") {
          location = "Room A305";
          deadline = new Date(sessionStart.getTime() + durationMinutes * 60000);
          eventEndsAt = deadline;
        } else if (category === "LECTURE") {
          if (sample.title.toLowerCase().includes("semester 1")) {
            title = "Computer Architecture";
            location = "Room C201";
          } else {
            location = "Room B210";
          }
          eventEndsAt = new Date(
            sessionStart.getTime() + durationMinutes * 60000,
          );
        }

        if (this.prisma?.session?.create) {
          const createdSession = await this.prisma.session.create({
            data: {
              userId,
              title: n > 1 ? `${title} (#${i + 1})` : title,
              type,
              source,
              location,
              durationMinutes,
              scheduledStartTime: sessionStart,
              deadline,
              note: sample.content,
            },
          });
          sessionId = createdSession.id;
        }
      }

      const row = await this.create(userId, {
        ...sample,
        title: n > 1 ? `${sample.title} (#${i + 1})` : sample.title,
        sessionId,
        eventEndsAt,
      });
      this.notify(NotificationEvent.NEW_SESSION, row);
      raised.push(toNotificationDto(row));
    }
    return raised;
  }

  /**
   * A sync-conflict row (a `sync_conflict.*` `eventName`, issue #62 D). Unlike
   * {@link create} it never materializes a calendar session - it points at the
   * user's own conflicting tasks via `conflictSessionIds`. The caller emits.
   */
  async raiseConflict(
    userId: string,
    dto: {
      /** Always `"sync_conflict.<category>"` — see {@link notificationEventKind}. */
      eventName: string;
      title: string;
      content: string;
      conflictSessionIds: string[];
    },
  ): Promise<Notification> {
    const recipient = await this.prisma.user?.findUnique({
      where: { id: userId },
      select: { lang: true },
    });
    const row = await this.prisma.notification.create({
      data: {
        userId,
        eventName: dto.eventName,
        title: dto.title,
        content: dto.content,
        conflictSessionIds: dto.conflictSessionIds,
        sessionId: null,
        eventEndsAt: null,
      },
    });
    return localizeNotification(row, recipient?.lang);
  }

  /** The caller's own `sync_conflict.*` row, or 404. */
  async findConflict(user: User, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findFirst({
      where: {
        id,
        userId: user.id,
        eventName: { startsWith: "sync_conflict." },
      },
    });
    if (!row) {
      throw new NotFoundException(`Cannot find conflict notification ${id}`);
    }
    return row;
  }

  /**
   * `DELETE /notifications/:id` — dismiss a row for good.
   *
   * Scoped to the caller (`userId` in the `where`), so another student's row is
   * a 404, never a 403; `P2025` from a stale id lands the same way. A hard
   * delete rather than a `dismissedAt` stamp: a dismissed inbox row carries no
   * signal worth keeping, and `readAt` / `actionTakenAt` already cover "seen"
   * and "acted on".
   */
  async remove(user: User, id: string): Promise<{ id: string }> {
    try {
      await this.prisma.notification.delete({
        where: { id, userId: user.id },
      });
      return { id };
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException(`Cannot find notification with id ${id}`);
      }
      throw error;
    }
  }

  /**
   * One page of the inbox, **newest first**.
   *
   * Ordering is by `sentAt` alone, deliberately independent of read state: the
   * client marks every shown row read as soon as the inbox opens, so an
   * unread-first order would reshuffle the list the instant it is looked at and
   * — with `take` in play — silently drop just-read rows off the page. Unread is
   * surfaced by row styling and by `unreadCount`, not by position.
   *
   * `unreadCount` deliberately counts the whole inbox rather than the page: it
   * drives the badge, which must not shrink as the user pages forward.
   */
  async list(
    user: User,
    dto: ListNotificationsDto,
  ): Promise<NotificationsListResponse> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { sentAt: "desc" },
        take: dto.limit ?? 20,
        skip: dto.offset ?? 0,
      }),
      this.prisma.notification.count({
        where: { userId: user.id, readAt: null },
      }),
    ]);

    return {
      notifications: rows.map((row) =>
        toNotificationDto(localizeNotification(row, user.lang)),
      ),
      unreadCount,
    };
  }

  /** `PATCH /notifications/:id/read` — stamp `readAt`. Idempotent. */
  async markRead(user: User, id: string): Promise<NotificationDto> {
    return this.stamp(user, id, "readAt");
  }

  /**
   * `PATCH /notifications/:id/action-taken` — stamp `actionTakenAt`.
   *
   * Distinct from {@link markRead}: seeing a notification is not acting on it,
   * and the difference is exactly the signal that says whether the inbox is
   * useful.
   */
  async markActionTaken(user: User, id: string): Promise<NotificationDto> {
    return this.stamp(user, id, "actionTakenAt");
  }

  /**
   * Stamp one timestamp column, scoped to the caller.
   *
   * `userId` is part of the `where`, so another student's notification is
   * simply not found — a 404 rather than a 403, which is also what a caller
   * passing a stale id gets. Both arrive here as Prisma's `P2025`.
   *
   * Re-stamping keeps the first instant: "read at" should mean when they first
   * read it, not when they last scrolled past it.
   */
  private async stamp(
    user: User,
    id: string,
    column: "readAt" | "actionTakenAt",
  ): Promise<NotificationDto> {
    try {
      const row = await this.prisma.notification.update({
        where: { id, userId: user.id, [column]: null },
        data: { [column]: new Date() },
      });
      return toNotificationDto(localizeNotification(row, user.lang));
    } catch (error) {
      if (!this.isRecordNotFound(error)) throw error;
      // Either it is not this user's row, or it was already stamped. Tell the
      // two apart with a read rather than reporting a 404 for a repeat call.
      const existing = await this.prisma.notification.findFirst({
        where: { id, userId: user.id },
      });
      if (!existing) {
        throw new NotFoundException(`Cannot find notification with id ${id}`);
      }
      return toNotificationDto(localizeNotification(existing, user.lang));
    }
  }

  private isRecordNotFound(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === (PostgresErrorCode.RecordNotFound as string)
    );
  }
}
