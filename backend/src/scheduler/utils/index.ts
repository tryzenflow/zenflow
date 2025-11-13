import { Task } from "../interfaces";

export function getTaskDuration(task: Task, scheduleBased = true): number {
  const placeholderSchedules = task.schedules.filter(
    (s) => s.start === undefined && s.end === undefined
  );

  if (
    !scheduleBased ||
    task.schedules.length === 0 ||
    placeholderSchedules.length > 0
  ) {
    return task.duration;
  } else {
    return task.schedules
      .filter((s) => s.start !== undefined && s.end !== undefined)
      .reduce((sum, s) => sum + (s.end! - s.start!), 0);
  }
}

export function getTaskEarliestStart(
  task: Task,
  scheduleBased = true
): number | undefined {
  if (task.earliestStart === undefined) {
    return;
  }

  const placeholderSchedules = task.schedules.filter(
    (s) => s.start === undefined && s.end === undefined
  );

  if (
    !scheduleBased ||
    task.schedules.length === 0 ||
    placeholderSchedules.length > 0
  ) {
    return task.earliestStart;
  } else {
    const validStarts = task.schedules
      .filter((s) => s.start !== undefined && s.end !== undefined)
      .map((s) => s.start!)
      .concat(task.earliestStart);

    return Math.min(...validStarts);
  }
}

export function getTaskLatestEnd(
  task: Task,
  scheduleBased = true
): number | undefined {
  if (task.latestEnd === undefined) {
    return;
  }

  const placeholderSchedules = task.schedules.filter(
    (s) => s.start === undefined && s.end === undefined
  );

  if (
    !scheduleBased ||
    task.schedules.length === 0 ||
    placeholderSchedules.length > 0
  ) {
    return task.latestEnd;
  } else {
    const validEnds = task.schedules
      .filter((s) => s.start !== undefined && s.end !== undefined)
      .map((s) => s.end!)
      .concat(task.latestEnd);

    return Math.max(...validEnds);
  }
}

export function getTaskMaxSplits(task: Task, scheduleBased = true): number {
  const placeholderSchedules = task.schedules.filter(
    (s) => s.start === undefined && s.end === undefined
  );

  if (
    !scheduleBased ||
    task.maxSplits === 1 ||
    task.schedules.length === 0 ||
    placeholderSchedules.length > 0
  ) {
    return task.maxSplits;
  } else {
    return task.schedules.length;
  }
}
