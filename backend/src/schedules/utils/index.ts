import { BadRequestException } from "@nestjs/common";
import { isDateString } from "class-validator";

export const extractDate = (date: Date) => {
  return date.toISOString().substring(0, 10);
};

export const getDateOnlyString = (year: number, month: number, day: number) => {
  const dateOnly = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  if (!isDateString(dateOnly))
    throw new BadRequestException("Invalid date provided");
  return dateOnly;
};
