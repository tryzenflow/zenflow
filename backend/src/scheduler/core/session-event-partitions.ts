/**
 * Pure planning for the monthly `SessionEvent` partitions (ADR-0016): which
 * future months to pre-create and which expired ones to drop. No I/O, no clock;
 * `now` is a parameter. Months are UTC, matching how Prisma stores `occurredAt`.
 */

export const SESSION_EVENT_RETENTION_MONTHS = 12;
export const SESSION_EVENT_MONTHS_AHEAD = 2;

const PARTITION_NAME = /^SessionEvent_(\d{4})_(\d{2})$/;

/** First instant of the UTC month `offset` months from `now`'s month. */
export function monthStart(now: Date, offset = 0): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
  );
}

export function partitionName(month: Date): string {
  const mm = String(month.getUTCMonth() + 1).padStart(2, "0");
  return `SessionEvent_${month.getUTCFullYear()}_${mm}`;
}

/** The month a partition holds, or null for a name that is not one of ours. */
export function parsePartitionName(name: string): Date | null {
  const m = PARTITION_NAME.exec(name);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(Number(m[1]), month - 1, 1));
}

export interface PartitionPlan {
  /** Month starts to create (current month through `monthsAhead`), oldest first. */
  create: Date[];
  /** Partition names wholly older than the retention window. */
  drop: string[];
}

export function planPartitions(
  now: Date,
  existing: string[],
  retentionMonths = SESSION_EVENT_RETENTION_MONTHS,
  monthsAhead = SESSION_EVENT_MONTHS_AHEAD,
): PartitionPlan {
  const have = new Set(existing);
  const create: Date[] = [];
  for (let i = 0; i <= monthsAhead; i++) {
    const month = monthStart(now, i);
    if (!have.has(partitionName(month))) create.push(month);
  }

  // A partition holds month M..M+1; drop it once M+1 is at or before the cutoff.
  const cutoff = monthStart(now, -retentionMonths).getTime();
  const drop = existing
    .filter((name) => {
      const month = parsePartitionName(name);
      return month !== null && monthStart(month, 1).getTime() <= cutoff;
    })
    .sort();

  return { create, drop };
}

/** Consecutive existing months after the current one (0 when next month is missing). */
export function countMonthsAhead(now: Date, existing: string[]): number {
  const have = new Set(existing);
  let n = 0;
  while (have.has(partitionName(monthStart(now, n + 1)))) n++;
  return n;
}
