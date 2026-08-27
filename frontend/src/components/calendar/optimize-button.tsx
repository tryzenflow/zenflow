import { useState } from "react";
import { addDays } from "date-fns";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { isAxiosError } from "axios";
import { Button } from "@/components/ui/button";
import { optimizeSchedule, undoOptimize } from "@/api/scheduler";
import { errorToast } from "@/lib/toast";

/**
 * Header entry point for the new, minimal Optimize (trigger 4 from
 * notes.md): `POST /scheduler/optimize` over a fixed "now → +14 days" window,
 * applied immediately — no preview step, no mode picker (the old 3-mode
 * full/balanced/fixed picker and its large-batch confirm guard were dropped
 * along with the EDF scheduler engine; see `frontend/README.md`). The result
 * is a one-line diff-count toast with an "Undo" action that reverts the whole
 * batch via `undoOptimize`. Mirrors
 * `mobile/components/calendar/day-timeline.tsx`'s Optimize trigger.
 */
export function OptimizeButton({ onOptimized }: { onOptimized: () => void }) {
  const [optimizing, setOptimizing] = useState(false);

  async function handleOptimize() {
    if (optimizing) return;
    setOptimizing(true);
    try {
      const windowStart = new Date();
      const { batchId, diffs } = await optimizeSchedule(
        windowStart,
        addDays(windowStart, 14),
      );

      if (diffs.length === 0) {
        toast.info("Nothing to optimize");
        return;
      }

      onOptimized();
      toast.success(
        `Optimized ${diffs.length} session${diffs.length === 1 ? "" : "s"}`,
        {
          action: {
            label: "Undo",
            onClick: () => {
              undoOptimize(batchId)
                .then(() => {
                  toast.info("Optimize undone");
                  onOptimized();
                })
                .catch(() => {
                  errorToast("Couldn't undo — the schedule may have changed");
                });
            },
          },
        },
      );
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Couldn't optimize your schedule",
      );
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-label="Optimize schedule"
      title="Optimize schedule (next 14 days)"
      disabled={optimizing}
      onClick={handleOptimize}
    >
      <Sparkles className="size-4" />
    </Button>
  );
}
