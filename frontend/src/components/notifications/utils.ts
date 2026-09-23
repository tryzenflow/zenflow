import { SESSION_TYPE_META } from "@zenflow/core";
import {
  notificationCategory,
  notificationEventKind,
  NotificationCategory,
  NotificationDto,
  SessionType,
} from "@zenflow/shared";
import { formatInTimeZone } from "date-fns-tz";
import { Bell, LucideIcon, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { sessionTypeIcon } from "@/components/calendar/session-type-badge";

/** Which session type a category put on the calendar — `REMINDER` puts nothing. */
const CATEGORY_TYPE: Record<NotificationCategory, SessionType | null> = {
  ASSIGNMENT: "ASSIGNMENT",
  EXAM: "EXAM",
  LECTURE: "LECTURE",
  REMINDER: null,
};

/**
 * Icon + tile tint for a notification — the calendar session block's own icon
 * and type accent (assignment teal, exam rose, lecture sky), so an inbox row
 * reads as the thing it put on the calendar. `REMINDER` has no session type,
 * so it rides the brand primary with the bell.
 */
export function notificationVisual(eventName: string): {
  Icon: LucideIcon;
  tint: string;
} {
  if (isConflict(eventName))
    return {
      Icon: TriangleAlert,
      tint: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    };
  const type = CATEGORY_TYPE[notificationCategory(eventName)];
  if (!type)
    return { Icon: Bell, tint: "border-primary/40 bg-primary/15 text-primary" };
  const meta = SESSION_TYPE_META[type];
  return {
    Icon: sessionTypeIcon(type),
    tint: cn("border", meta.badgeClass, meta.textClass),
  };
}

/**
 * The fixed "due" / "at" label for a row, off the linked session's end instant
 * (`eventEndsAt`). An assignment reads `due Jul 8`; an exam or lecture, which
 * has a clock time, reads `Jul 5, 9:00 AM`. Null for grouped rows and drops.
 */
export function eventTimeLabel(n: NotificationDto, tz: string): string | null {
  if (!n.eventEndsAt) return null;
  const at = new Date(n.eventEndsAt);
  const date = formatInTimeZone(at, tz, "MMM d");
  if (notificationCategory(n.eventName) === "ASSIGNMENT") return `due ${date}`;
  return `${date}, ${formatInTimeZone(at, tz, "h:mm a")}`;
}

/** Never reached for `REMINDER` — reminders never raise a sync conflict. */
const CONFLICT_COPY: Partial<Record<NotificationCategory, string>> = {
  ASSIGNMENT: "An assignment now overlaps your tasks",
  EXAM: "An exam now overlaps your tasks",
  LECTURE: "A class now overlaps your tasks",
};

/** True for a sync-conflict notification (#62). */
export function isConflict(eventName: string): boolean {
  return notificationEventKind(eventName) === "CONFLICT";
}

/** Short inbox headline for a conflict notification, or null for other rows. */
export function conflictCopy(eventName: string): string | null {
  if (!isConflict(eventName)) return null;
  return CONFLICT_COPY[notificationCategory(eventName)] ?? null;
}
