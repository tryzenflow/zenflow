import { TIME_GRANULARITY } from "@zenflow/core";

export function snap(minutes: number) {
  return Math.round(minutes / TIME_GRANULARITY) * TIME_GRANULARITY;
}
