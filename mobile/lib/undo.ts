/** How long an undo toast stays up, and how long a delete waits before it is sent. */
export const UNDO_WINDOW_MS = 5000;

/**
 * Run `commit` once the undo window closes. The returned function cancels it,
 * which is what Undo calls. Calling it after the commit has run does nothing.
 */
export function deferCommit(
  commit: () => void | Promise<void>,
  ms: number = UNDO_WINDOW_MS,
): () => void {
  let settled = false;
  const timer = setTimeout(() => {
    settled = true;
    void commit();
  }, ms);
  return () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
  };
}
