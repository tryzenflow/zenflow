import { DAILY_HORIZON, TIME_REGEX } from "../../common/constants";

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
