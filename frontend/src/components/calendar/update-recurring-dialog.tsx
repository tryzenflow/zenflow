import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { SeriesKind } from "@zenflow/core";
import type { UpdateScope } from "@zenflow/shared";
import { CalendarClock, CalendarDays, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScopeChoice {
  scope: UpdateScope;
  skipConflicting: boolean;
}

interface Option {
  scope: UpdateScope;
  Icon: typeof CalendarClock;
  label: string;
  hint: string;
  /** Fires immediately on click instead of expanding a skip-conflicting row. */
  immediate?: boolean;
}

const COPY: Record<"recurring" | "task", { title: string; options: Option[] }> = {
  recurring: {
    title: "Update recurring session",
    options: [
      {
        scope: "following",
        Icon: CalendarRange,
        label: "This and following",
        hint: "Occurrences from this one onward move to the new time.",
      },
      {
        scope: "series",
        Icon: CalendarDays,
        label: "All occurrences",
        hint: "Every occurrence in the series moves to the new time.",
      },
    ],
  },
  task: {
    title: "Update session",
    options: [
      {
        scope: "occurrence",
        Icon: CalendarClock,
        label: "This sitting",
        hint: "Only this sitting moves.",
        immediate: true,
      },
      {
        scope: "following",
        Icon: CalendarRange,
        label: "This and later sittings",
        hint: "Later sittings keep their dates but move to the new time.",
      },
      {
        scope: "series",
        Icon: CalendarDays,
        label: "All sittings",
        hint: "Every sitting keeps its date but moves to the new time.",
      },
    ],
  },
};

/**
 * "Which occurrences should this drag/resize apply to?" — the web counterpart
 * of `mobile/components/calendar/update-recurring-sheet.tsx`. `onResolve` fires
 * once with the chosen `{ scope, skipConflicting }`, or `null` if dismissed.
 */
export function UpdateRecurringDialog({
  open,
  kind,
  onResolve,
}: {
  open: boolean;
  kind: Exclude<SeriesKind, "none">;
  onResolve: (choice: ScopeChoice | null) => void;
}) {
  const [expanded, setExpanded] = useState<UpdateScope | null>(null);
  const [skipConflicting, setSkipConflicting] = useState(false);
  const { title, options } = COPY[kind];

  const reset = () => {
    setExpanded(null);
    setSkipConflicting(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onResolve(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose which occurrences pick up the new time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map(({ scope, Icon, label, hint, immediate }) => {
            const isExpanded = expanded === scope;
            return (
              <div key={scope}>
                <button
                  type="button"
                  onClick={() => {
                    if (immediate) {
                      reset();
                      onResolve({ scope, skipConflicting: false });
                    } else {
                      setSkipConflicting(false);
                      setExpanded((p) => (p === scope ? null : scope));
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    isExpanded
                      ? "rounded-b-none border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                </button>
                {isExpanded && (
                  <div className="space-y-3 rounded-b-lg border border-t-0 border-primary bg-primary/10 px-3 pb-3 pt-2.5">
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={skipConflicting}
                        onCheckedChange={(v) => setSkipConflicting(v === true)}
                      />
                      Skip ones that would conflict
                    </label>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        reset();
                        onResolve({ scope, skipConflicting });
                      }}
                    >
                      Confirm
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
