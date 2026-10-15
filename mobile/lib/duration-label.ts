import { formatMinutes } from "@zenflow/core";
import { locale } from "./i18n";

/** Readout for a duration in minutes, in the app's language. */
export function durationLabel(minutes: number): string {
  if (locale() !== "vi-VN") return formatMinutes(minutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h} giờ` : ""}${m ? ` ${m} phút` : ""}`.trim();
}
