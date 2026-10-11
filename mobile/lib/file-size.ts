const UNITS = ["B", "KB", "MB", "GB"];

/** "812 B", "4.2 KB", "13 MB", "1.5 GB": one decimal below 10, none above. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} ${UNITS[0]}`;
  const text =
    value < 10
      ? value.toFixed(1).replace(/\.0$/, "")
      : String(Math.round(value));
  return `${text} ${UNITS[unit]}`;
}
