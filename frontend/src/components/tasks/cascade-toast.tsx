import { ArrowLeftRight, Undo2 } from "lucide-react";

/**
 * Toast body shown when a create/update/drag/resize/delete mutation's inline
 * reoptimize moved OTHER tasks as a side effect (`response.displaced`). Uses a
 * distinct icon (`ArrowLeftRight`) from the rationale toast (`Sparkles`) and
 * the duration-adjustment toast (`Undo2`) so the three are visually
 * distinguishable when sonner stacks them together.
 */
export function CascadeToast({
  count,
  onUndo,
  onDismiss,
}: {
  count: number;
  onUndo: () => void;
  /** Close the toast. */
  onDismiss: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
          <ArrowLeftRight className="size-3.5 text-primary" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground">
            {count} other task{count === 1 ? "" : "s"} moved
          </p>
          <p className="text-xs text-muted-foreground">
            Rescheduled to make room.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1.5 self-end rounded-md border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
        >
          <Undo2 className="size-3" /> Undo
        </button>
      </div>
    </div>
  );
}
