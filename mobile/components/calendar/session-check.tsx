import { CheckOffButton } from "@/components/calendar/check-off-button";
import { useCheckOff } from "@/hooks/use-check-off";
import { type CheckState, checkStateOf } from "@/lib/today-summary";
import type { Session } from "@zenflow/shared";
import { useState } from "react";

/**
 * Check-off state of a row, kept locally so the row can restyle at once. Only
 * tasks are checkable; `check` is the disc for the row's right edge, or null.
 */
export function useSessionCheck(session: Session) {
  const checkOff = useCheckOff();
  const [override, setOverride] = useState<CheckState | null>(null);
  const state = override ?? checkStateOf(session);
  const check =
    session.type === "TASK" ? (
      <CheckOffButton
        state={state}
        title={session.title}
        onToggle={async (next) => {
          const ok = await checkOff({ id: session.id, title: session.title }, "complete", next === "done");
          if (ok) setOverride(next === "done" ? "done" : "open");
          return ok;
        }}
      />
    ) : null;
  return { done: state === "done", check };
}
