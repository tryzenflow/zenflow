import {
  AlertTriangle,
  Bell,
  ClipboardList,
  GraduationCap,
  type LucideIcon,
  Notebook,
} from "@/components/Icons";
import type { ToastAccent } from "@/components/ui/toast";
import {
  type NotificationCategory,
  notificationCategory,
  notificationEventKind,
} from "@zenflow/shared";
import { SESSION_TONE_CLASSES, SESSION_TONES } from "@zenflow/core";
import { t } from "./i18n";

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  get ASSIGNMENT() {
    return t("LMS Assignment");
  },
  get EXAM() {
    return t("Exam");
  },
  get LECTURE() {
    return t("Timetable");
  },
  get REMINDER() {
    return t("Reminder");
  },
};

/**
 * Icon and colors for a notification's eventName, matching
 * mockups/detected-items.html. Shared by the inbox rows and the live
 * notification toast, so both show the same glyph for the same kind.
 * `iconColor` is the inbox's single ink; `accent` adds a dark-scheme pair.
 */
export function notificationVisual(eventName: string): {
  Icon: LucideIcon;
  label: string;
  tint: string;
  iconColor: string;
  accent: ToastAccent;
} {
  const category = notificationCategory(eventName);
  if (notificationEventKind(eventName) === "CONFLICT") {
    return {
      Icon: AlertTriangle,
      label: t("{category} conflict", { category: CATEGORY_LABEL[category] }),
      tint: SESSION_TONE_CLASSES.conflict.badge,
      iconColor: SESSION_TONES.conflict.ink.light,
      accent: SESSION_TONES.conflict.ink,
    };
  }
  switch (category) {
    case "ASSIGNMENT":
      return {
        Icon: ClipboardList,
        label: CATEGORY_LABEL.ASSIGNMENT,
        tint: SESSION_TONE_CLASSES.assignment.badge,
        iconColor: SESSION_TONES.assignment.ink.light,
        accent: SESSION_TONES.assignment.ink,
      };
    case "EXAM":
      return {
        Icon: Notebook,
        label: CATEGORY_LABEL.EXAM,
        tint: SESSION_TONE_CLASSES.exam.badge,
        iconColor: SESSION_TONES.exam.ink.light,
        accent: SESSION_TONES.exam.ink,
      };
    case "LECTURE":
      return {
        Icon: GraduationCap,
        label: CATEGORY_LABEL.LECTURE,
        tint: SESSION_TONE_CLASSES.lecture.badge,
        iconColor: SESSION_TONES.lecture.ink.light,
        accent: SESSION_TONES.lecture.ink,
      };
    default:
      return {
        Icon: Bell,
        label: CATEGORY_LABEL.REMINDER,
        tint: SESSION_TONE_CLASSES.task.badge,
        iconColor: SESSION_TONES.task.ink.light,
        accent: SESSION_TONES.task.ink,
      };
  }
}

/** `icon` + `accent` for a notification's toast. Tolerates a missing or
 * unrecognized eventName (an older push payload) with the reminder bell. */
export function notificationToastVisual(eventName: string | undefined): {
  icon: LucideIcon;
  accent: ToastAccent;
} {
  try {
    if (eventName) {
      const { Icon, accent } = notificationVisual(eventName);
      return { icon: Icon, accent };
    }
  } catch {
    // Unrecognized eventName — fall through to the bell.
  }
  return { icon: Bell, accent: SESSION_TONES.task.ink };
}
