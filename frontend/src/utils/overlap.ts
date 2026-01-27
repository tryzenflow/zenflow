import { ScheduledBlock } from "@/types/schedule";

export function getOverlapSpacing(events: ScheduledBlock[]) {
  const spacings = new Map<string, number>();
  events.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  events.forEach((event, i) => {
    if (i === 0) return;
    const overlap =
      new Date(event.start).getTime() < new Date(events[i - 1].end).getTime();
    if (!spacings.has(event.id)) {
      spacings.set(event.id, 0);
    }
    if (overlap)
      spacings.set(event.id, spacings.get(events[i - 1].id) || 0 + 1);
  });
  return spacings;
}
