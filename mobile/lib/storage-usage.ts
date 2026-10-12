/** Share of the quota at which Settings starts warning that storage is nearly full. */
export const STORAGE_WARN_RATIO = 0.8;

export type StorageLevel = "ok" | "warn" | "full";

/** Bar fill (0-100) and warning level for `usedBytes` of `quotaBytes`. */
export function storageUsage(
  usedBytes: number,
  quotaBytes: number,
): { percent: number; level: StorageLevel } {
  if (!(quotaBytes > 0)) return { percent: 0, level: "ok" };
  const ratio = Math.max(0, usedBytes) / quotaBytes;
  const level: StorageLevel =
    ratio >= 1 ? "full" : ratio >= STORAGE_WARN_RATIO ? "warn" : "ok";
  return { percent: Math.min(100, Math.round(ratio * 100)), level };
}
