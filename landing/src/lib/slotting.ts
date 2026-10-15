/** Times are minutes after midnight on the 15 minute grid. */
export const SLOT = 15;

export interface Busy {
  start: number;
  end: number;
}

export interface DemoTask {
  id: string;
  minutes: number;
  deadline: number;
}

/**
 * Toy version of the app's placement for the hero demo: earliest deadline first,
 * each task takes the first free slot from `from` that ends by its deadline.
 * Tasks with no room are left out of the result.
 */
export function placeTasks(
  busy: Busy[],
  tasks: DemoTask[],
  from: number,
  until: number,
): Map<string, Busy> {
  const taken = [...busy];
  const placed = new Map<string, Busy>();
  const order = [...tasks].sort((a, b) => a.deadline - b.deadline || a.id.localeCompare(b.id));
  for (const task of order) {
    const last = Math.min(task.deadline, until) - task.minutes;
    for (let start = Math.ceil(from / SLOT) * SLOT; start <= last; start += SLOT) {
      const slot = { start, end: start + task.minutes };
      if (taken.every((b) => slot.end <= b.start || slot.start >= b.end)) {
        taken.push(slot);
        placed.set(task.id, slot);
        break;
      }
    }
  }
  return placed;
}

/** `13:30` style wall clock. */
export const clock = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
