import { updateBasicInfo } from "@/api/users";
import { useUserStore } from "@/hooks/use-user-store";
import { checklistProgress } from "@/lib/checklist";
import type { TipId } from "@zenflow/shared";
import { create } from "zustand";

/** Done this session (per user), so a failed server write can't un-tick a step. */
const useDoneThisSession = create<{ userId: string | null; done: ReadonlySet<TipId> }>(
  () => ({ userId: null, done: new Set() }),
);
const NONE: ReadonlySet<TipId> = new Set();

/**
 * Tick a checklist step off (or hide the checklist with `"checklist-hidden"`).
 * Call it from the place the action happens; it's a no-op once done, signed
 * out, or when the same step is already being saved. Best-effort: offline, it
 * stays ticked for this session and is re-ticked the next time the user does it.
 * Returns `true` only when this call newly ticked the step (so callers can
 * celebrate the first time).
 */
export function completeStep(id: TipId): boolean {
  const { user, updateUser } = useUserStore.getState();
  if (!user) return false;
  const session = useDoneThisSession.getState();
  const done = session.userId === user.id ? session.done : NONE;
  if (done.has(id) || user.seenTips?.includes(id)) return false;
  useDoneThisSession.setState({ userId: user.id, done: new Set(done).add(id) });
  void updateBasicInfo({ seenTip: id })
    .then(updateUser)
    .catch(() => {});
  return true;
}

/** The checklist's progress for the signed-in user. */
export function useChecklist() {
  const user = useUserStore((s) => s.user);
  const session = useDoneThisSession();
  return checklistProgress(
    user?.seenTips,
    user && session.userId === user.id ? session.done : NONE,
  );
}
