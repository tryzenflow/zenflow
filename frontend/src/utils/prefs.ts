import { FocusBlock } from "../types/prefs";

export const minutesToTime = (minutes: number): string => {
  const totalHours = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = totalHours % 12 === 0 ? 12 : totalHours % 12;
  const ampm = totalHours >= 12 ? "PM" : "AM";
  return `${hours}:${m.toString().padStart(2, "0")} ${ampm}`;
};

export const EARLY_BIRD_BLOCKS: FocusBlock[] = [
  { id: "eb1", level: 3, start: 300, end: 540 },
  { id: "eb2", level: 2, start: 540, end: 780 },
  { id: "eb3", level: 1, start: 780, end: 960 },
  { id: "eb3", level: 2, start: 960, end: 1200 },
];

export const NIGHT_OWL_BLOCKS: FocusBlock[] = [
  { id: "no1", level: 1, start: 480, end: 660 },
  { id: "no2", level: 2, start: 660, end: 900 },
  { id: "no3", level: 3, start: 900, end: 1200 },
  { id: "no3", level: 2, start: 1200, end: 1380 },
  { id: "no4", level: 3, start: 1380, end: 1440 },
  { id: "no4", level: 3, start: 0, end: 120 },
];
