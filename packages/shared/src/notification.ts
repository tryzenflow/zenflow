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
 * Machine-readable classification of what a notification reports.
 * Derived from {@link NotificationDto.eventName} by {@link notificationEventKind}
 * rather than stored separately, so there is exactly one field to keep in sync.
 */
export type NotificationEventKind = "CREATED" | "UPDATED" | "REMOVED" | "CONFLICT";

/**
 * Classify a notification's {@link NotificationDto.eventName} without
 * pattern-matching the free-text `title`/`content`. Every event name is
 * either `"sync_conflict.<thing>"` (a conflict) or `"<thing>.<created|
 * updated|removed>"` / `"<thing>.group_<created|updated|removed>"`.
 */
export function notificationEventKind(eventName: string): NotificationEventKind {
  if (eventName.startsWith("sync_conflict.")) return "CONFLICT";
  if (eventName.endsWith("created")) return "CREATED";
  if (eventName.endsWith("updated")) return "UPDATED";
  if (eventName.endsWith("removed")) return "REMOVED";
  throw new Error(`Unrecognized notification eventName: "${eventName}"`);
}

/**
 * What a notification is about — which inbox section/icon it takes, and
 * (for `ASSIGNMENT`/`EXAM`/`LECTURE`) which calendar session type it tracks.
 * `REMINDER` is the non-ingestion, user-facing nudge; it has no session type
 * of its own. Derived from {@link NotificationDto.eventName}'s `<thing>`
 * segment by {@link notificationCategory}, same reasoning as
 * {@link notificationEventKind}.
 */
export type NotificationCategory = "ASSIGNMENT" | "EXAM" | "LECTURE" | "REMINDER";

/**
 * The `<thing>` a notification's {@link NotificationDto.eventName} is about —
 * `"assignment.created"` / `"lecture.group_updated"` → the part before the
 * first `.`; `"sync_conflict.lecture"` → the part after it.
 */
export function notificationCategory(eventName: string): NotificationCategory {
  const thing = eventName.startsWith("sync_conflict.")
    ? eventName.slice("sync_conflict.".length)
    : eventName.split(".")[0];
  switch (thing) {
    case "assignment":
      return "ASSIGNMENT";
    case "exam":
      return "EXAM";
    case "lecture":
      return "LECTURE";
    case "reminder":
      return "REMINDER";
    default:
      throw new Error(`Unrecognized notification eventName: "${eventName}"`);
  }
}

/** One notification as returned by the notifications endpoints. */
export interface NotificationDto {
  id: string;
  /**
   * Stable machine-readable slug ("assignment.created", "lecture.removed",
   * "sync_conflict.exam", …) — safe to switch on, unlike `title`/`content`.
   * See {@link notificationEventKind} and {@link notificationCategory} for
   * the classifications derived from this.
   */
  eventName: string;
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
  /**
   * For a `CONFLICT` row (see {@link notificationEventKind}): ids of the
   * user's own flexible tasks that a sync landed on top of ("Reschedule them
   * all?" — `POST /notifications/:id/reschedule-conflicts`). Empty otherwise.
   */
  conflictSessionIds: string[];
}

/** `data` payload for `POST /notifications/:id/reschedule-conflicts`. */
export interface RescheduleConflictsResponse {
  /** Tasks successfully re-placed (each recorded as a `SYSTEM_MOVE`). */
  rescheduled: DisplacedSessionRef[];
  /** Tasks that could not be re-placed conflict-free (still conflicting). */
  failedSessionIds: string[];
  /** `true` when any task was re-placed by the basic fallback (placement service unavailable). */
  schedulingDegraded?: boolean;
}

export interface DisplacedSessionRef {
  id: string;
  /** ISO-8601 previous start. */
  from: string;
  /** ISO-8601 new start. */
  to: string;
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
