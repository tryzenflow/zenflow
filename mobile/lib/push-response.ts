let lastHandledResponse: string | null = null;

/**
 * `true` the first time a notification response (`id:action`) is seen; `false`
 * for a replay — a remount re-reads the saved last response, and the same tap
 * can arrive through both the cold-start read and the listener.
 */
export function markResponseHandled(key: string): boolean {
  if (key === lastHandledResponse) return false;
  lastHandledResponse = key;
  return true;
}
