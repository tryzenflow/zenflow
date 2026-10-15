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
  /** Translucent fill and rim: a glass badge in the category's colour. */
  tint: string;
  /** Icon colour per scheme, strong enough to read on the glass. */
  ink: { light: string; dark: string };
  accent: ToastAccent;
} {
  const category = notificationCategory(eventName);
  if (notificationEventKind(eventName) === "CONFLICT") {
    const ink = { light: "#b45309", dark: "#fbbf24" };
    return {
      Icon: AlertTriangle,
      label: t("{category} conflict", { category: CATEGORY_LABEL[category] }),
      tint: "border-amber-500/50 bg-amber-500/20",
      ink,
      accent: ink,
    };
  }
  switch (category) {
    case "ASSIGNMENT": {
      const ink = { light: "#0f766e", dark: "#2dd4bf" };
      return {
        Icon: ClipboardList,
        label: CATEGORY_LABEL.ASSIGNMENT,
        tint: "border-teal-500/50 bg-teal-500/20",
        ink,
        accent: ink,
      };
    }
    case "EXAM": {
      const ink = { light: "#be123c", dark: "#fb7185" };
      return {
        Icon: Notebook,
        label: CATEGORY_LABEL.EXAM,
        tint: "border-rose-500/50 bg-rose-500/20",
        ink,
        accent: ink,
      };
    }
    case "LECTURE": {
      const ink = { light: "#0369a1", dark: "#38bdf8" };
      return {
        Icon: GraduationCap,
        label: CATEGORY_LABEL.LECTURE,
        tint: "border-sky-500/50 bg-sky-500/20",
        ink,
        accent: ink,
      };
    }
    default: {
      const ink = { light: "#c2410c", dark: "#fb923c" };
      return {
        Icon: Bell,
        label: CATEGORY_LABEL.REMINDER,
        tint: "border-primary/50 bg-primary/20",
        ink,
        accent: ink,
      };
    }
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
