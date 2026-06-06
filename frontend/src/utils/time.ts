import { DAILY_HORIZON, TIME_GRANULARITY } from "./constants";

export const minutesToTime = (minutes: number): string => {
  if (minutes === DAILY_HORIZON) return "11:59 PM";
  const totalHours = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = totalHours % 12 === 0 ? 12 : totalHours % 12;
  const ampm = totalHours >= 12 ? "PM" : "AM";
  return `${hours}:${m.toString().padStart(2, "0")} ${ampm}`;
};

export const minutesToMilitaryTime = (minutes: number): string => {
  if (minutes === DAILY_HORIZON) return "23:59:59";
  const totalHours = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${totalHours.toString().padStart(2, "0")}:${m
    .toString()
    .padStart(2, "0")}:00`;
};
export const timeToMinutes = (time: string): number => {
  if (!time.match(/\d{1,2}:\d{1,2} (AM|PM)/))
    throw new Error("Invalid time provided, got " + time);
  const [t, ampm] = time.split(" ");
  const [h, m] = t.split(":");
  const militaryHour =
    ampm === "AM" ? (h === "12" ? 0 : +h) : h === "12" ? 12 : +h + 12;

  const minutes = militaryHour * 60 + +m;
  if (minutes === DAILY_HORIZON - 1) return minutes + 1;
  return minutes;
};

export const militaryTimeToMinutes = (time: string): number => {
  if (!time.match(/\d{1,2}:\d{1,2}/))
    throw new Error("Invalid time provided, got " + time);
  const [h, m] = time.split(":");
  const minutes = +h * 60 + +m;
  if (minutes === DAILY_HORIZON - 1) return minutes + 1;
  return minutes;
};

export const formatMinutes = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourWord = " h";
  const minuteWord = " min";
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}${hourWord}`);
  if (minutes > 0) parts.push(`${minutes}${minuteWord}`);
  return parts.length > 0 ? parts.join(" ") : "0" + minuteWord;
};

export const durationToMinutes = (duration: string): number => {
  const parts = duration.split(" ");
  let hour = 0;
  let minute = 0;
  if (parts.length === 4) {
    const [h, , m] = parts;
    hour = +h;
    minute = +m;
  } else {
    const timeUnit = parts[1];
    if (timeUnit.startsWith("h")) hour = +parts[0];
    else minute = +parts[0];
  }
  return +hour * 60 + +minute;
};

export const snapToNearestLaterQuarterHour = (minutes: number): number => {
  const remainder = minutes % TIME_GRANULARITY;
  return minutes + TIME_GRANULARITY - remainder;
};
