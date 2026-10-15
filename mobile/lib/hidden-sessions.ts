import type { Session } from "@zenflow/shared";

/** Sessions to hide: one by id, or a series, optionally from a start onward. */
export type HideRule =
  | { id: string }
  | { seriesId: string; fromISO?: string };

const rules = new Set<HideRule>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

function matches(rule: HideRule, s: Pick<Session, "id" | "seriesId" | "scheduledStartTime">) {
  if ("id" in rule) return s.id === rule.id;
  if (s.seriesId !== rule.seriesId) return false;
  if (!rule.fromISO) return true;
  return (
    s.scheduledStartTime != null &&
    new Date(s.scheduledStartTime) >= new Date(rule.fromISO)
  );
}

/** Hide sessions until the returned function is called (Undo, or a failed delete). */
export function hideSessions(rule: HideRule): () => void {
  rules.add(rule);
  emit();
  return () => {
    if (rules.delete(rule)) emit();
  };
}

export function filterHidden<T extends Pick<Session, "id" | "seriesId" | "scheduledStartTime">>(
  list: T[],
): T[] {
  if (rules.size === 0) return list;
  const out = list.filter((s) => ![...rules].some((r) => matches(r, s)));
  return out.length === list.length ? list : out;
}

export function subscribeHidden(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function hiddenVersion(): number {
  return version;
}
