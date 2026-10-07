/**
 * Runs async tasks strictly one at a time, in call order, and lets callers
 * invalidate tasks that were requested but have not started yet.
 *
 * Used for push register/unregister: an in-flight login registration must not
 * finish *after* a later unregister (it would re-add the device token), and a
 * registration still waiting in line when the user turns notifications off
 * must never run.
 */
export function createSerialGate() {
  let tail: Promise<unknown> = Promise.resolve();
  let epoch = 0;

  return {
    /** Invalidate every task requested so far that has not started yet. */
    invalidate(): void {
      epoch++;
    },
    /**
     * Queue `fn` behind earlier tasks. If the gate was invalidated between
     * this call and the task's turn, `fn` is skipped and `onSkipped` is the
     * result. `fn` also receives `isCurrent()` to re-check after its own
     * awaits (e.g. after fetching a token, before the POST).
     */
    run<T>(
      fn: (isCurrent: () => boolean) => Promise<T>,
      onSkipped: T,
    ): Promise<T> {
      const mine = epoch;
      const isCurrent = () => mine === epoch;
      const result = tail.then(
        () => (isCurrent() ? fn(isCurrent) : onSkipped),
        () => (isCurrent() ? fn(isCurrent) : onSkipped),
      );
      tail = result.catch(() => {});
      return result;
    },
  };
}
