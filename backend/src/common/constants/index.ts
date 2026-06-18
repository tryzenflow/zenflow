export const DAILY_HORIZON = 24 * 60;
export const TIME_REGEX = /^(((0|1)[0-9])|(2[0-3])):([0-5][0-9])$/;
export const ORDER_GAP = 4096;
export const DAY_OF_WEEK = 7;
export const TIME_GRANULARITY = 15;

/**
 * Grace window (ms) before a deadline-overdue PENDING task is swept into the
 * ABANDONED state. Keeps the hourly sweep from racing a user who completes a
 * task slightly past its deadline. Default: 1 hour.
 */
export const ABANDON_GRACE_MS = 60 * 60 * 1000;

/**
 * Max tasks the abandoned-task sweep processes per transaction, so one run never
 * opens a single unbounded transaction over the whole overdue backlog.
 */
export const ABANDON_BATCH_SIZE = 100;
