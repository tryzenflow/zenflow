export const DAILY_HORIZON = 24 * 60;
export const TIME_REGEX = /^(((0|1)[0-9])|(2[0-3])):([0-5][0-9])$/;
export const ORDER_GAP = 4096;
export const DAY_OF_WEEK = 7;
export const TIME_GRANULARITY = 15;

/**
 * Grace window (ms) after a scheduled TASK's end before the outcome sweep
 * settles a check-off or skip (ADR-0022). Default: 15 minutes.
 */
export const OUTCOME_GRACE_MS = 15 * 60 * 1000;

/**
 * Cutoff (ms) after a scheduled TASK's end with no check-off, at which the
 * outcome sweep settles the placement as missed (ADR-0022). Default: 24 hours.
 */
export const OUTCOME_MISS_CUTOFF_MS = 24 * 60 * 60 * 1000;

/**
 * Max sessions the outcome sweep processes per transaction, so one run never
 * opens a single unbounded transaction over the whole elapsed backlog.
 */
export const OUTCOME_BATCH_SIZE = 100;

/** AES-256-GCM: 96-bit IV (NIST SP 800-38D recommended), 256-bit key. */
export const IV_RANDOM_BYTES_SIZE = 12;
export const KEY_RANDOM_BYTES_SIZE = 32;
export const ENCRYPTION_ALGORITHM = "aes-256-gcm";
