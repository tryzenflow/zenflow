import { DAILY_HORIZON, EnergyBlock } from "../types/prefs";

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
  const hourWord = hours !== 1 ? " hours" : " hour";
  const minuteWord = minutes !== 1 ? " minutes" : " minute";
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
    if (timeUnit.startsWith("hour")) hour = +parts[0];
    else minute = +parts[0];
  }
  return +hour * 60 + +minute;
};

export const EARLY_BIRD_BLOCKS: EnergyBlock[] = [
  { id: "eb1", level: 3, start: 300, end: 540 },
  { id: "eb2", level: 2, start: 540, end: 780 },
  { id: "eb3", level: 1, start: 780, end: 960 },
  { id: "eb3", level: 2, start: 960, end: 1200 },
];

export const NIGHT_OWL_BLOCKS: EnergyBlock[] = [
  { id: "no1", level: 1, start: 480, end: 660 },
  { id: "no2", level: 2, start: 660, end: 900 },
  { id: "no3", level: 3, start: 900, end: 1200 },
  { id: "no3", level: 2, start: 1200, end: 1380 },
  { id: "no4", level: 3, start: 1380, end: 1440 },
  { id: "no4", level: 3, start: 0, end: 120 },
];
