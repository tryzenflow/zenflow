import { isDateString } from "class-validator";
import { DAILY_HORIZON, TIME_REGEX } from "../constants";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { BadRequestException } from "@nestjs/common";

export const minuteToTime = (minute: number) => {
  if (minute < 0 || minute > DAILY_HORIZON)
    throw new Error(
      `Minute must be between 0 and ${DAILY_HORIZON}, got ${minute}`
    );
  if (minute === DAILY_HORIZON) return "23:59";
  const hrs = Math.floor(minute / 60);
  const mins = minute % 60;
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
};

export const timeToMinute = (time: string) => {
  const match = TIME_REGEX.exec(time);
  if (!match) {
    throw new Error(`Invalid time format: ${time}. Expected HH:mm`);
  }
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export function utcToMinutes(
  date: Date, // stored UTC date
  timezone: string // e.g. "Europe/Paris"
): number {
  const local = toZonedTime(date, timezone);
  return local.getHours() * 60 + local.getMinutes();
}

export function minutesToUtc(
  dateString: string,
  minutes: number,
  timezone: string
): Date {
  const local = new Date(`${dateString}T00:00:00`);
  local.setHours(0, minutes, 0, 0);
  return fromZonedTime(local, timezone);
}

export const extractDate = (date: Date) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dateOnly = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return dateOnly;
};

export const getDateOnlyString = (year: number, month: number, day: number) => {
  const dateOnly = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  if (!isDateString(dateOnly))
    throw new BadRequestException({
      success: false,
      message: "Invalid date provided",
    });
  return dateOnly;
};

export function getWeekday(dayNumber: number) {
  const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  if (dayNumber >= 0 && dayNumber <= 6) {
    return weekdays[dayNumber];
  } else {
    throw new BadRequestException({
      success: false,
      message: `Day number must be between 0 and 6, got ${dayNumber}`,
    });
  }
}
