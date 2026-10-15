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

/** Fetch the student's DLU profile (`/api/student/info`) and study programs. */
export interface ProfileJobData {
  userId: string;
  integrationId: string;
}

/** Fetch marks for one student; fans out one request per study program. */
export interface MarksJobData {
  userId: string;
  integrationId: string;
}

/** Enrolment discovery for one student (portal DKHP history or LMS courses). */
export interface DiscoveryJobData {
  userId: string;
  integrationId: string;
  /** The claimed `IngestionSchedule` row this job settles. */
  scheduleId?: string;
  /** ISO instant of the claim; `releaseClaim`'s compare-and-set token. */
  claimedAt?: string;
  /** ISO instant the row was due before the claim. */
  dueAt?: string;
  cacheHitStreak?: number;
}

/**
 * One unit of a fan-out pass: a timetable week (`unit` is the Monday,
 * `YYYY-MM-DD`) or an LMS calendar month (`unit` is `YYYY-MM`). `runId` is the
 * `SyncRun` the unit reports its completion to.
 */
export interface UnitJobData {
  runId: string;
  userId: string;
  integrationId: string;
  unit: string;
}

/** Channel jobs on the `notify` queue. */
export type NotifyJobData =
  /** Native push for one provider of a notification row. */
  | { type: "push"; notificationId: string; provider: PushProvider }
  /** Fire one session reminder; `startsAt` (ISO) is the occurrence it was armed for. */
  | { type: "reminder"; reminderId: string; startsAt: string }
  /** Morning brief or evening check-in for one user and local day, one provider. */
  | {
      type: "daily";
      userId: string;
      kind: "morning" | "evening";
      /** `YYYY-MM-DD` in the user's timezone. */
      localDate: string;
      provider: PushProvider;
    };

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

/** Student profile and study programs (one login, two requests). */
export const PORTAL_PROFILE_QUEUE = defineQueue<ProfileJobData>({
  name: "portal-profile",
  concurrency: 1,
});

/** Marks and grades; enqueued after the profile lands. */
export const PORTAL_MARKS_QUEUE = defineQueue<MarksJobData>({
  name: "portal-marks",
  concurrency: 1,
});

/** DKHP enrolment discovery. */
export const PORTAL_DISCOVERY_QUEUE = defineQueue<DiscoveryJobData>({
  name: "portal-discovery",
  concurrency: 1,
});

/** One timetable week per job: served from the cache or fetched alone. */
export const PORTAL_WEEK_QUEUE = defineQueue<UnitJobData>({
  name: "portal-week",
  concurrency: 1,
});

/** Moodle enrolled-courses discovery. */
export const LMS_DISCOVERY_QUEUE = defineQueue<DiscoveryJobData>({
  name: "lms-discovery",
  concurrency: 1,
});

/** One LMS calendar month per job (current and next are separate jobs). */
export const LMS_MONTH_QUEUE = defineQueue<UnitJobData>({
  name: "lms-month",
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
  PORTAL_PROFILE_QUEUE,
  PORTAL_MARKS_QUEUE,
  PORTAL_DISCOVERY_QUEUE,
  PORTAL_WEEK_QUEUE,
  LMS_DISCOVERY_QUEUE,
  LMS_MONTH_QUEUE,
  NOTIFY_QUEUE,
] as const;
