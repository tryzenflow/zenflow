import { t } from "@/lib/i18n";

/** Compact "5 min ago" / "3 hours ago" / "2 days ago" for a past ISO instant. */
export function shortAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{count} min ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{count} hours ago", { count: hours });
  return t("{count} days ago", { count: Math.floor(hours / 24) });
}
