import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { isAxiosError } from "axios";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { errorToast } from "@/lib/toast";
import { zonedDate } from "@/utils/tz";
import { slotPick } from "@/api/tasks";
import type { Session } from "@zenflow/shared";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Side = "primary" | "alternative";

interface SlotPickDialogProps {
  open: boolean;
  sessionId: string;
  slotProposalId: string;
  primarySlot: string;
  alternativeSlot: string;
  /** Session title, shown for context ("Two good times for <title>"). */
  title: string;
  tz: string;
  /** Fires once the pick (or a no-op "keep") is fully resolved. */
  onResolved: (session: Session) => void;
  /** Fires when the sheet is dismissed without a resolved session. */
  onDismiss: () => void;
}

/**
 * Shown after a divergent A/B slot proposal on a single TASK create/deadline
 * change — mirrors `UpdateRecurringDialog`'s option-card shape. Model
 * identities never surface here, only the two candidate times.
 */
export function SlotPickDialog({
  open,
  sessionId,
  slotProposalId,
  primarySlot,
  alternativeSlot,
  title,
  tz,
  onResolved,
  onDismiss,
}: SlotPickDialogProps) {
  const [selected, setSelected] = useState<Side>("primary");
  const [loading, setLoading] = useState(false);
  const fmt = (iso: string) => format(zonedDate(iso, tz), "EEE MMM d, HH:mm");

  const options: { side: Side; label: string; iso: string }[] = [
    { side: "primary", label: "Currently scheduled", iso: primarySlot },
    { side: "alternative", label: "Alternative time", iso: alternativeSlot },
  ];

  function reset() {
    setSelected("primary");
    setLoading(false);
  }

  function keepPrimary() {
    reset();
    onDismiss();
  }

  async function switchToAlternative() {
    setLoading(true);
    try {
      const { session } = await slotPick(sessionId, {
        slotProposalId,
        chose: "alternative",
      });
      toast.success(
        `Moved to ${fmt(alternativeSlot)} — thanks, noted for next time`,
      );
      reset();
      onResolved(session);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Couldn't switch the time",
      );
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) keepPrimary();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Two good times for this</DialogTitle>
          <DialogDescription>
            {title ? `"${title}" ` : ""}fits either time below — pick
            whichever suits you.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map(({ side, label, iso }) => {
            const isSelected = selected === side;
            return (
              <button
                key={side}
                type="button"
                onClick={() => setSelected(side)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  {isSelected && <Check className="size-4 text-primary" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmt(iso)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Your pick helps Zenflow learn which times actually work for you —
          it never moves anything else on your calendar.
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            disabled={loading}
            onClick={keepPrimary}
          >
            Keep {fmt(primarySlot)}
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={loading}
            onClick={switchToAlternative}
          >
            Switch to {fmt(alternativeSlot)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
