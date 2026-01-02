export function inferMaxSplits(duration: number): number {
  if (duration <= 60) return 1;
  if (duration <= 120) return 2;
  if (duration <= 180) return 3;
  return 4;
}
