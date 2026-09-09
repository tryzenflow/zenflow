/**
 * Notifications raised by the DLU ingestion watchers.
 *
 * An ingested item lands on the calendar *and* raises a notification. The
 * notification's call to action is "create prep / revision / reminder tasks
 * around this", not "confirm that this item is real" — the item already exists
 * upstream, so there is nothing for the student to accept or reject.
 *
 * Only what crosses the wire lives here. Watcher run state — job rows, per
 * request status, parse counts — is a backend-internal diagnostic and is
 * deliberately absent; the one thing callers can see about a run is the
 * `lastSyncedAt` / `lastSyncStatus` pair on `IntegrationStatus`.
 *
 * As everywhere else in this package, instants cross the wire as **ISO-8601
 * strings**, never `Date`s, and "absent" is an explicit `| null` rather than an
 * optional property.
 */

/**
 * What a notification is about.
 *
 * `ASSIGNMENT` / `EXAM` are raised when a watcher creates the matching calendar
 * session. `TIMETABLE` covers class-schedule changes — including the "upstream
 * moved, but you had already edited this session, so we did not overwrite it"
 * case. `REMINDER` is the non-ingestion, user-facing nudge.
 */
export type NotificationTopic =
  | "ASSIGNMENT"
  | "EXAM"
  | "TIMETABLE"
  | "REMINDER";

/**
 * How the row is categorised, for its inbox badge:
 * - `NEW` — something new landed on the calendar
 * - `CHANGE` — an upstream change to an item already on the calendar
 * - `DROP` — an item was removed upstream
 */
export type NotificationKind = "NEW" | "CHANGE" | "DROP";

/** One notification as returned by the notifications endpoints. */
export interface NotificationDto {
  id: string;
  topic: NotificationTopic;
  kind: NotificationKind;
  title: string;
  content: string;
  /**
   * ISO-8601 end instant of the fixed session behind this row (its
   * `scheduledStartTime` + duration) — the "due"/"at" time the inbox shows for
   * an assignment, exam or lecture. Null for grouped timetable rows and for
   * removals, which have no single session.
   */
  eventEndsAt: string | null;
  /** ISO-8601 instant the notification was raised. */
  sentAt: string;
  /** ISO-8601 instant the user read it, or null while unread. */
  readAt: string | null;
  /**
   * ISO-8601 instant the user acted on it (created the prep task, dismissed the
   * suggestion, …), or null. Distinct from {@link readAt}: seeing a
   * notification is not acting on it.
   */
  actionTakenAt: string | null;
  /**
   * The calendar session this notification points at — the row the watcher just
   * wrote — or null for notifications with no session behind them.
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
