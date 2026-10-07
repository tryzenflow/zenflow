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
      tint: "border-amber-500/40 bg-amber-500/15",
      iconColor: "#d97706",
      accent: { light: "#d97706", dark: "#fbbf24" },
    };
  }
  switch (category) {
    case "ASSIGNMENT":
      return {
        Icon: ClipboardList,
        label: CATEGORY_LABEL.ASSIGNMENT,
        tint: "border-teal-500/40 bg-teal-500/15",
        iconColor: "#0f766e",
        accent: { light: "#0f766e", dark: "#2dd4bf" },
      };
    case "EXAM":
      return {
        Icon: Notebook,
        label: CATEGORY_LABEL.EXAM,
        tint: "border-rose-500/40 bg-rose-500/15",
        iconColor: "#e11d48",
        accent: { light: "#e11d48", dark: "#fb7185" },
      };
    case "LECTURE":
      return {
        Icon: GraduationCap,
        label: CATEGORY_LABEL.LECTURE,
        tint: "border-sky-500/40 bg-sky-500/15",
        iconColor: "#0369a1",
        accent: { light: "#0369a1", dark: "#38bdf8" },
      };
    default:
      return {
        Icon: Bell,
        label: CATEGORY_LABEL.REMINDER,
        tint: "border-primary/40 bg-primary/15",
        iconColor: "#f97316",
        accent: { light: "#f97316", dark: "#fb923c" },
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
  return { icon: Bell, accent: { light: "#f97316", dark: "#fb923c" } };
}
