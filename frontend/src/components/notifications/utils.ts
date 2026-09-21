import { SESSION_TYPE_META } from "@zenflow/core";
import {
  NotificationDto,
  NotificationTopic,
  SessionType,
} from "@zenflow/shared";
import { formatInTimeZone } from "date-fns-tz";
import { Bell, LucideIcon, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { sessionTypeIcon } from "@/components/calendar/session-type-badge";

/** Which session type a topic put on the calendar — `REMINDER` puts nothing. */
const TOPIC_TYPE: Record<NotificationTopic, SessionType | null> = {
  ASSIGNMENT: "ASSIGNMENT",
  EXAM: "EXAM",
  TIMETABLE: "LECTURE",
  REMINDER: null,
  ASSIGNMENT_CONFLICT: "ASSIGNMENT",
  EXAM_CONFLICT: "EXAM",
  TIMETABLE_CONFLICT: "LECTURE",
};

/**
 * Icon + tile tint for a topic — the calendar session block's own icon and
 * type accent (assignment teal, exam rose, lecture sky), so an inbox row reads
 * as the thing it put on the calendar. `REMINDER` has no session type, so it
 * rides the brand primary with the bell.
 */
export function topicVisual(topic: NotificationTopic): {
  Icon: LucideIcon;
  tint: string;
} {
  if (isConflictTopic(topic))
    return {
      Icon: TriangleAlert,
      tint: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    };
  const type = TOPIC_TYPE[topic];
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
  if (n.topic === "ASSIGNMENT") return `due ${date}`;
  return `${date}, ${formatInTimeZone(at, tz, "h:mm a")}`;
}

const CONFLICT_COPY: Partial<Record<NotificationTopic, string>> = {
  ASSIGNMENT_CONFLICT: "An assignment now overlaps your tasks",
  EXAM_CONFLICT: "An exam now overlaps your tasks",
  TIMETABLE_CONFLICT: "A class now overlaps your tasks",
};

/** True for the sync-conflict topics (#62). */
export function isConflictTopic(topic: NotificationTopic): boolean {
  return topic in CONFLICT_COPY;
}

/** Short inbox headline for a conflict topic, or null for other topics. */
export function conflictCopy(topic: NotificationTopic): string | null {
  return CONFLICT_COPY[topic] ?? null;
}
