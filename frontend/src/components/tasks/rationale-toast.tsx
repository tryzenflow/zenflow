import { Sparkles } from "lucide-react";
import type { SchedulingRationale } from "@/types/phase2";
import { minutesToLabel } from "@/components/settings/preferences-fields";

/** ISO weekday (1=Mon … 7=Sun) short labels for the rationale's top cells. */
const WEEKDAY_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A 96-block index → the minute-of-day label for that 15-min block's start. */
function blockLabel(block: number) {
  return minutesToLabel(block * 15);
}

/**
 * Toast body shown when a reschedule/resize placed a task into a
 * preference-favoured slot and the backend returned a
 * {@link SchedulingRationale}. A custom sonner body (not the single-line
 * `action` slot) so we can render the human summary plus the optional
 * preferred window / top day×block cells that drove the pick.
 */
export function RationaleToast({
  title,
  rationale,
  onDismiss,
}: {
  title: string;
  rationale: SchedulingRationale;
  /** Close the toast. */
  onDismiss: () => void;
}) {
  const { summary, preferredWindow, topCells } = rationale;
  const cells = (topCells ?? []).slice(0, 3);

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
          <Sparkles className="size-3.5 text-primary" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground">
            Scheduled to your rhythm
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{title}</span> —{" "}
            {summary}
          </p>
        </div>
      </div>

      {preferredWindow && (
        <p className="pl-8 font-mono text-[11px] text-muted-foreground">
          Preferred window {minutesToLabel(preferredWindow.startMin)} –{" "}
          {minutesToLabel(preferredWindow.endMin)}
        </p>
      )}

      {cells.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-8">
          {cells.map((c) => (
            <span
              key={`${c.day}:${c.block}`}
              className="rounded border border-brand-orange/40 bg-brand-orange/15 px-1.5 py-0.5 font-mono text-[10px] font-medium"
              title={`score ${c.score > 0 ? "+" : ""}${c.score}`}
            >
              {WEEKDAY_LABEL[c.day] ?? `D${c.day}`} {blockLabel(c.block)}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onDismiss}
        className="self-end text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}
