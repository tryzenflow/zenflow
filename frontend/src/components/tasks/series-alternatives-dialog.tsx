import { useState } from "react";
import { format } from "date-fns";
import { isAxiosError } from "axios";
import { Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiErrorMessage, errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { zonedDate } from "@/utils/tz";
import { slotPick } from "@/api/tasks";
import { useUserStore } from "@/hooks/use-user-store";
import {
  useSeriesAlternativesStore,
  type PendingSeriesAlternatives,
  type SeriesAlternative,
} from "@/hooks/use-series-alternatives-store";

/** Per-sitting lifecycle: untouched → swapping → swapped (locked), or taken on a 409. */
type RowStatus = "idle" | "loading" | "swapped" | "taken";

/**
 * The per-sitting surface for a materialized TASK series (#58): one row per
 * divergent sitting (never all M), each a primary/alternative radio-card pair
 * in `SlotPickDialog`'s visual language with the already-applied primary
 * pre-selected. Picking an alternative calls `POST /sessions/:id/slot-pick`
 * for that sitting right away and locks the row; closing sends nothing, so
 * every untouched sitting stays as scheduled. Model identity never surfaces.
 *
 * Mounted once by the calendar layout; opened from the toast raised by
 * `promptSeriesAlternatives`.
 */
export function SeriesAlternativesDialog() {
  const pending = useSeriesAlternativesStore((s) => s.pending);
  const open = useSeriesAlternativesStore((s) => s.open);
  const clear = useSeriesAlternativesStore((s) => s.clear);
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  if (!pending) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) clear();
      }}
    >
      <DialogContent className="gap-5 sm:max-w-lg">
        <AlternativesBody
          // Fresh row state for each new series prompt.
          key={pending.sittings.map((s) => s.slotProposalId).join(",")}
          pending={pending}
          tz={tz}
          onDone={clear}
        />
      </DialogContent>
    </Dialog>
  );
}

function AlternativesBody({
  pending,
  tz,
  onDone,
}: {
  pending: PendingSeriesAlternatives;
  tz: string;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const { title, total, sittings } = pending;
  const setRow = (id: string, s: RowStatus) =>
    setStatus((prev) => ({ ...prev, [id]: s }));

  async function swap(sitting: SeriesAlternative) {
    setRow(sitting.sessionId, "loading");
    try {
      await slotPick(sitting.sessionId, {
        slotProposalId: sitting.slotProposalId,
        chose: "alternative",
      });
      setRow(sitting.sessionId, "swapped");
      // The calendar layout refetches on this signal, so the moved sitting
      // shows up at its new time immediately.
      window.dispatchEvent(new Event("zenflow:calendar-refresh"));
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        // SLOT_TAKEN: the alternative now overlaps another sitting.
        setRow(sitting.sessionId, "taken");
        return;
      }
      setRow(sitting.sessionId, "idle");
      errorToast("Couldn't switch the time", {
        description: apiErrorMessage(
          error,
          "That sitting stays where it was. Try again in a moment.",
        ),
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Alternative times</DialogTitle>
        <DialogDescription>
          {title ? `${title} · ` : ""}
          {sittings.length} of {total} sittings have an alternative
        </DialogDescription>
      </DialogHeader>
      <div className="-mx-1 max-h-[60vh] space-y-3.5 overflow-y-auto px-1">
        {sittings.map((sitting) => (
          <SittingRow
            key={sitting.sessionId}
            sitting={sitting}
            total={total}
            tz={tz}
            status={status[sitting.sessionId] ?? "idle"}
            onSwap={() => swap(sitting)}
          />
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Pick an alternative to move just that sitting — it's applied right
        away. Closing keeps the rest as scheduled.
      </p>
      <DialogFooter>
        <Button className="w-full" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function SittingRow({
  sitting,
  total,
  tz,
  status,
  onSwap,
}: {
  sitting: SeriesAlternative;
  total: number;
  tz: string;
  status: RowStatus;
  onSwap: () => void;
}) {
  const swapped = status === "swapped";
  const taken = status === "taken";
  const loading = status === "loading";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-muted-foreground">
        <span>
          Sitting {sitting.index}/{total}
        </span>
        {swapped && <span className="text-primary">Moved</span>}
      </div>
      <div
        role="radiogroup"
        aria-label={`Sitting ${sitting.index} of ${total}`}
        className="grid grid-cols-2 gap-2"
      >
        <SlotCard
          label="Scheduled"
          iso={sitting.primarySlot}
          durationMinutes={sitting.durationMinutes}
          tz={tz}
          selected={!swapped}
          disabled={status !== "idle" && status !== "taken"}
          onSelect={() => {}}
        />
        <SlotCard
          label="Alternative"
          iso={sitting.alternativeSlot}
          durationMinutes={sitting.durationMinutes}
          tz={tz}
          selected={swapped}
          disabled={status !== "idle"}
          loading={loading}
          unavailable={taken}
          onSelect={onSwap}
        />
      </div>
    </div>
  );
}

function SlotCard({
  label,
  iso,
  durationMinutes,
  tz,
  selected,
  disabled,
  loading = false,
  unavailable = false,
  onSelect,
}: {
  label: string;
  iso: string;
  durationMinutes: number;
  tz: string;
  selected: boolean;
  disabled: boolean;
  loading?: boolean;
  unavailable?: boolean;
  onSelect: () => void;
}) {
  // Each card carries its OWN date — an alternative can land on another day.
  const start = zonedDate(iso, tz);
  const end = zonedDate(
    new Date(Date.parse(iso) + durationMinutes * 60_000),
    tz,
  );

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card enabled:hover:bg-muted",
        unavailable && "opacity-60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40",
        )}
      >
        {selected && <Check className="size-2.5" strokeWidth={3} />}
        {loading && (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold text-muted-foreground">
          {format(start, "EEE MMM d")} · {label}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-sm font-semibold tabular-nums",
            unavailable && "line-through",
          )}
        >
          {format(start, "HH:mm")} – {format(end, "HH:mm")}
        </span>
        {unavailable && (
          <span className="mt-0.5 block text-[11px] text-destructive">
            No longer available
          </span>
        )}
      </span>
    </button>
  );
}
