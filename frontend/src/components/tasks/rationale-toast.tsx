import { AlertTriangle, Sparkles } from "lucide-react";
import type { SchedulingRationale } from "@/types/phase2";
import { minutesToLabel } from "@/components/settings/preferences-fields";
import { cn } from "@/lib/utils";

/** ISO weekday (1=Mon … 7=Sun) short labels for the rationale's top cells. */
const WEEKDAY_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A 96-block index → the minute-of-day label for that 15-min block's start. */
function blockLabel(block: number) {
  return minutesToLabel(block * 15);
}

/**
 * Toast body shown whenever a placement-affecting response (create, an
 * accepted edit-reschedule offer, drag, resize) carries a rationale — every
 * tiered placement now returns one (see `buildTierRationale`, tier-aware:
 * tier1-preference / tier1-earliest / tier2-off-hours / tier3-past-deadline /
 * saturated). A custom sonner body (not the single-line `action` slot) so we
 * can render the human summary plus the optional preferred window / top
 * day×block cells that drove the pick.
 *
 * `rationale` can be the full {@link SchedulingRationale} object (drag/
 * resize/resolve) or a plain summary string (create, whose
 * `schedulingMeta.rationale` is just `tierRationale.summary`) — normalized to
 * the same shape either way.
 *
 * `conflict` switches to the conflict-notice framing (drag/resize landing on
 * top of another task): an amber `AlertTriangle` instead of the primary
 * `Sparkles`, and "Landed on an overlap" instead of "Scheduled to your
 * rhythm" — the summary text itself already names the overlapping task
 * (backend-authored), this just avoids the positive "to your rhythm" framing
 * for what is actually a heads-up.
 */
export function RationaleToast({
  title,
  rationale,
  conflict,
  onDismiss,
}: {
  title: string;
  rationale: SchedulingRationale | string;
  /** True when the placement landed on an occupied slot. */
  conflict?: boolean;
  /** Close the toast. */
  onDismiss: () => void;
}) {
  const normalized: SchedulingRationale =
    typeof rationale === "string" ? { summary: rationale } : rationale;
  const { summary, preferredWindow, topCells } = normalized;
  const cells = (topCells ?? []).slice(0, 3);

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
            conflict
              ? "border-amber-400/50 bg-amber-100 dark:bg-amber-950"
              : "border-primary/30 bg-primary/10",
          )}
        >
          {conflict ? (
            <AlertTriangle className="size-3.5 text-amber-700 dark:text-amber-400" />
          ) : (
            <Sparkles className="size-3.5 text-primary" />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground">
            {conflict ? "Landed on an overlap" : "Scheduled to your rhythm"}
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
