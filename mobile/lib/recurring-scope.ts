import { t } from "./i18n";
import { UNDO_WINDOW_MS, deferCommit } from "./undo";
import type { useToast } from "@/components/ui/toast";
import type { Session, UpdateScope } from "@zenflow/shared";
import { getSeriesKind } from "@zenflow/core";

type Toast = ReturnType<typeof useToast>["toast"];
type SeriesFields = Pick<Session, "seriesId" | "rrule" | "timetableGroupId">;

/** Which slice of a series a reschedule/resize should hit. */
export type UpdateRecurringScope = "occurrence" | "following" | "series";

export interface PendingSessionUpdate {
  scheduledStartTime: string;
  durationMinutes: number;
}

/** The scope a recurring move is sent with, or `null` when the user backed out. */
export type RecurringScopeChoice = {
  scope: UpdateRecurringScope;
  skipConflicting: boolean;
} | null;

/**
 * A recurring session moves this occurrence by default; the toast offers the
 * whole series. The send waits out the undo window, so Undo and Apply to all
 * both act before anything reaches the server.
 */
export function offerApplyToAll(
  toast: Toast,
  send: (scope: "occurrence" | "series") => void | Promise<void>,
  onUndo: () => void = () => {},
): void {
  const cancel = deferCommit(() => send("occurrence"), UNDO_WINDOW_MS);
  toast({
    title: t("Moved this occurrence"),
    variant: "success",
    icon: "calendar-check",
    duration: UNDO_WINDOW_MS,
    actions: [
      {
        label: t("Undo"),
        onPress: () => {
          cancel();
          onUndo();
        },
      },
      {
        label: t("Apply to all"),
        onPress: () => {
          cancel();
          void send("series");
        },
      },
    ],
  });
}

/**
 * Scope choice for a drag, move or edit. A recurring session asks nothing:
 * it moves this occurrence and offers apply to all. A multi-sitting task
 * still asks through `openTaskSheet`. Anything else moves on its own.
 */
export function resolveMoveScope(
  toast: Toast,
  session: Session,
  pending: PendingSessionUpdate,
  onResolve: (choice: RecurringScopeChoice) => void,
  openTaskSheet: (
    session: Session,
    pending: PendingSessionUpdate,
    onResolve: (choice: RecurringScopeChoice) => void,
  ) => void,
): void {
  const kind = getSeriesKind(session);
  if (kind === "task") {
    openTaskSheet(session, pending, onResolve);
    return;
  }
  if (kind !== "recurring") {
    onResolve({ scope: "occurrence", skipConflicting: false });
    return;
  }
  offerApplyToAll(
    toast,
    (scope) =>
      onResolve({
        scope: scope === "series" ? "series" : "occurrence",
        skipConflicting: false,
      }),
    () => onResolve(null),
  );
}

/**
 * The scope a sent move uses, and whether its own undo can put the time back.
 * A recurring occurrence moved on its own detaches from the series, so only
 * the series-wide move can be reverted with a plain time PATCH.
 */
export function moveUndoable(
  session: SeriesFields,
  scope: UpdateScope | undefined,
): boolean {
  return !(scope === "occurrence" && getSeriesKind(session) === "recurring");
}
