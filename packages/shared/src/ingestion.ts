/**
 * DLU ingestion — the background watchers that pull a student's LMS
 * assignments/quizzes, class timetable and exam schedule onto their calendar,
 * and the notifications those watchers raise.
 *
 * Two things are modelled here:
 *
 * 1. **Job status** — every watcher run records a job row (and one item row per
 *    upstream request) so a bad parse is diagnosable after the fact. Only the
 *    status enum is part of the FE/BE contract; the job rows themselves are a
 *    backend-internal diagnostic and are not exposed over the wire.
 * 2. **Notifications** — an ingested item lands on the calendar *and* raises a
 *    notification. The notification's call to action is "create prep /
 *    revision / reminder tasks around this", not "confirm that this item is
 *    real" — the item already exists upstream.
 *
 * As everywhere else in this package, instants cross the wire as **ISO-8601
 * strings**, never `Date`s, and "absent" is an explicit `| null` rather than an
 * optional property.
 */

/**
 * Lifecycle of one ingestion run (or of a single request inside it).
 *
 * A run goes `PENDING` → `PROCESSING` → `COMPLETED` | `FAILED`. An individual
 * failed request stays `FAILED` and the run carries on; only a login failure
 * fails the whole job.
 */
export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

/**
 * What a notification is about.
 *
 * `ASSIGNMENT` / `EXAM` are raised when the watcher creates the matching
 * calendar session. `TIMETABLE` covers class-schedule changes — including the
 * "upstream moved, but you had already edited this session, so we did not
 * overwrite it" case. `REMINDER` is the non-ingestion, user-facing nudge.
 */
export type NotificationTopic =
  | "ASSIGNMENT"
  | "EXAM"
  | "TIMETABLE"
  | "REMINDER";

/** One notification as returned by the notifications endpoints. */
export interface NotificationDto {
  id: string;
  topic: NotificationTopic;
  title: string;
  content: string;
  /** ISO-8601 instant the notification was raised. */
  sentAt: string;
  /** ISO-8601 instant the user read it, or null while unread. */
  readAt: string | null;
  /**
   * ISO-8601 instant the user acted on it (created the prep task, dismissed
   * the suggestion, …), or null. Distinct from {@link readAt}: seeing a
   * notification is not acting on it.
   */
  actionTakenAt: string | null;
  /**
   * The calendar session this notification points at — the row the watcher
   * just wrote — or null for notifications with no session behind them.
   */
  sessionId: string | null;
}

/** `data` payload for `GET /notifications`. */
export interface NotificationsListResponse {
  notifications: NotificationDto[];
  /**
   * Unread count across the whole inbox, **not** just the returned page — it
   * drives the badge, which must not shrink as the user pages.
   */
  unreadCount: number;
}
