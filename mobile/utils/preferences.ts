import { getLanguage } from "@/lib/i18n";

/** Format minutes from midnight using the selected UI language. */
export function minutesToLabel(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (getLanguage() === "vi") {
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}
