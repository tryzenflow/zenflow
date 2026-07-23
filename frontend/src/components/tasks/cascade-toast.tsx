import { ArrowLeftRight, Undo2 } from "lucide-react";

/**
 * Toast body shown after an Optimize **apply** run (`POST /tasks/optimize/
 * apply`) — the only multi-task mutation left in the redesigned scheduler
 * (Create/Edit/Drag/Resize/Delete/Complete never cascade to other tasks
 * anymore, so this is no longer shown for them). Uses a distinct icon
 * (`ArrowLeftRight`) from the rationale toast (`Sparkles`) and the
 * duration-adjustment toast (`Undo2`) so the three stay visually
 * distinguishable when sonner stacks them together.
 *
 * Mode 2 ("retain manual") locks `manuallyMoved` tasks in place instead of
 * repacking them, so `fixedCount`/`unchangedCount` are present to render the
 * "Fixed N · M left unchanged (manually placed)" line; other modes omit them
 * and only the plain count + range shows.
 */
export function CascadeToast({
  count,
  rangeLabel,
  fixedCount,
  unchangedCount,
  onUndo,
  onDismiss,
}: {
  /** Tasks actually moved by this Optimize apply. */
  count: number;
  /** Preformatted window label, e.g. "Jul 22 – Jul 29". */
  rangeLabel: string;
  /** Mode 2 only: tasks locked at their current slot (manually placed). */
  fixedCount?: number;
  /** Mode 2 only: movable tasks reconsidered but left in their same slot. */
  unchangedCount?: number;
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
            {count} task{count === 1 ? "" : "s"} rescheduled
          </p>
          <p className="text-xs text-muted-foreground">
            Optimized {rangeLabel}.
          </p>
          {fixedCount != null && (
            <p className="text-xs text-muted-foreground">
              Fixed {fixedCount} (manually placed) · {unchangedCount ?? 0} left
              unchanged
            </p>
          )}
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
