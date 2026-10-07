import { t } from "./i18n";

/** "1 h 30 min" / "1 giờ 30 phút": a duration in the app language. */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(t("{count} h", { count: hours }));
  if (rest > 0 || hours === 0) parts.push(t("{count} min", { count: rest }));
  return parts.join(" ");
}
