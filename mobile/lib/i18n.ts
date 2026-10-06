import { zonedDate } from "@zenflow/core";
import { differenceInCalendarDays, format as dateFormat } from "date-fns";
import { enUS, vi } from "date-fns/locale";
import { localizeValidation } from "./i18n-validation";
import commonTranslations from "./i18n-common";
import taskTranslations from "./i18n-task";
import vietnamese from "./i18n-vi";

export type Language = "en" | "vi";
let language: Language = "vi";
const translations: Record<string, string> = {
  ...vietnamese,
  ...taskTranslations,
  ...commonTranslations,
};
const listeners = new Set<() => void>();
export function setLanguage(next: Language) {
  if (language === next) return;
  language = next;
  for (const listener of listeners) listener();
}
export function getLanguage() {
  return language;
}
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function locale() {
  return language === "vi" ? "vi-VN" : "en-US";
}
export function dateFnsLocale() {
  return language === "vi" ? vi : enUS;
}
export function t(
  key: string,
  values?: Record<string, string | number>,
): string {
  const translated =
    language === "vi"
      ? (translations[key] ?? localizeValidation(key, language) ?? key)
      : key;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) =>
    values?.[name] === undefined ? match : String(values[name]),
  );
}
/** Locale-sensitive display formatting; numeric API/cache dates keep their shape. */
export function format(
  date: Parameters<typeof dateFormat>[0],
  pattern: string,
  options?: Parameters<typeof dateFormat>[2],
) {
  const displayPattern =
    language === "vi"
      ? pattern
          .replace("'on'", "'ngày'")
          .replace(/h:mm a/g, "HH:mm")
          .replace(/h:mm/g, "HH:mm")
          .replace(/EEE MMM d/g, "EEE, d/M")
          .replace(/MMM d yyyy/g, "d/M/yyyy")
          .replace(/MMMM d/g, "d MMMM")
          .replace(/MMM d/g, "d/M")
      : pattern;
  return dateFormat(date, displayPattern, {
    ...options,
    locale: dateFnsLocale(),
  });
}

/** `format` for standalone labels (headers, titles): Vietnamese month/day names come back lowercase. */
export function formatTitle(...args: Parameters<typeof format>) {
  const text = format(...args);
  return text.charAt(0).toLocaleUpperCase(locale()) + text.slice(1);
}

export function localizedDeadlineShort(
  deadline: string,
  tz: string,
  ref: Date,
): string {
  const due = zonedDate(deadline, tz);
  const anchor = zonedDate(ref, tz);
  const days = differenceInCalendarDays(due, anchor);
  if (days === 0) return format(due, "h:mm a");
  if (days === 1) return t("tomorrow");
  return format(
    due,
    due.getFullYear() === anchor.getFullYear() ? "MMM d" : "MMM d yyyy",
  );
}
