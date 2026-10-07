/**
 * Delayed destructive actions with an Undo window. The caller hides the item
 * right away, `schedule`s it, and the real delete (`commit`) runs once
 * `delayMs` passes unless `undo` takes it back first. `flush` commits whatever
 * is still pending (leaving the screen must not drop a delete the user saw).
 */
export interface UndoQueue<T> {
  schedule: (id: string, item: T) => void;
  /** Cancel a pending commit and hand the item back, or `undefined` if it already ran. */
  undo: (id: string) => T | undefined;
  flush: () => void;
  size: () => number;
}

export function createUndoQueue<T>({
  delayMs,
  commit,
}: {
  delayMs: number;
  commit: (id: string, item: T) => void;
}): UndoQueue<T> {
  const pending = new Map<
    string,
    { item: T; timer: ReturnType<typeof setTimeout> }
  >();

  const run = (id: string) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    commit(id, entry.item);
  };

  return {
    schedule(id, item) {
      const existing = pending.get(id);
      if (existing) clearTimeout(existing.timer);
      pending.set(id, { item, timer: setTimeout(() => run(id), delayMs) });
    },
    undo(id) {
      const entry = pending.get(id);
      if (!entry) return undefined;
      clearTimeout(entry.timer);
      pending.delete(id);
      return entry.item;
    },
    flush() {
      for (const id of [...pending.keys()]) run(id);
    },
    size: () => pending.size,
  };
}
