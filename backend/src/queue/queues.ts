import { defineQueue } from "./queue.types";

/**
 * Payload of a `portal-fetch` / `lms-fetch` job: one provider sync for one
 * student. Owned by ingestion (campus-sync); shaped here so both queues share
 * a type. `dueAt` (ISO) is what makes the job id stable per schedule slot.
 */
export interface FetchJobData {
  /** `IngestionSchedule` row id; empty for a manual (API-triggered) job. */
  scheduleId: string;
  userId: string;
  integrationId: string;
  /** Ingestion kind (timetable, exam, discovery, calendar, ...). */
  kind: string;
  /** ISO instant the schedule row was due; part of the idempotency key. */
  dueAt: string;
  /** ISO instant of the claim; `releaseClaim`'s compare-and-set token. */
  claimedAt?: string;
  /** Consecutive cache-served passes at claim time (full-walk audit). */
  cacheHitStreak?: number;
  /** True for an API-triggered manual sync (not the watcher). */
  manual?: boolean;
}

/** Channel jobs on the `notify` queue. */
export type NotifyJobData =
  /** Native push for one provider of a notification row. */
  | { type: "push"; notificationId: string; provider: PushProvider }
  /** Fire one session reminder; `startsAt` (ISO) is the occurrence it was armed for. */
  | { type: "reminder"; reminderId: string; startsAt: string };

export type PushProvider = "fcm" | "apns";

/**
 * Portal (DLU timetable/exam/discovery) fetches. One request at a time per
 * replica; the worker's limiter keeps the upstream politeness delay.
 */
export const PORTAL_FETCH_QUEUE = defineQueue<FetchJobData>({
  name: "portal-fetch",
  concurrency: 1,
});

/** LMS (Moodle calendar/discovery) fetches. */
export const LMS_FETCH_QUEUE = defineQueue<FetchJobData>({
  name: "lms-fetch",
  concurrency: 1,
});

/** Push and reminder jobs. */
export const NOTIFY_QUEUE = defineQueue<NotifyJobData>({
  name: "notify",
  concurrency: 10,
  limiter: { max: 50, duration: 1_000 },
});

export const ALL_QUEUES = [
  PORTAL_FETCH_QUEUE,
  LMS_FETCH_QUEUE,
  NOTIFY_QUEUE,
] as const;
