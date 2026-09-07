import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SeriesKind } from "@zenflow/core";
import { CalendarDays, CalendarRange, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Which slice of a series a delete should hit. */
export type DeleteRecurringScope = "occurrence" | "following" | "series";

interface Option {
  scope: DeleteRecurringScope;
  Icon: typeof Trash2;
  label: string;
  hint: string;
  destructive?: boolean;
}

const COPY: Record<
  "recurring" | "task",
  { title: string; options: Option[] }
> = {
  recurring: {
    title: "Delete recurring session",
    options: [
      {
        scope: "occurrence",
        Icon: Trash2,
        label: "This occurrence",
        hint: "Only the tapped date is removed.",
      },
      {
        scope: "following",
        Icon: CalendarRange,
        label: "This and all following",
        hint: "The series ends before this occurrence.",
      },
      {
        scope: "series",
        Icon: CalendarDays,
        label: "All occurrences",
        hint: "Delete the entire series.",
        destructive: true,
      },
    ],
  },
  task: {
    title: "Delete session",
    options: [
      {
        scope: "occurrence",
        Icon: Trash2,
        label: "This sitting",
        hint: "Only this sitting is removed.",
      },
      {
        scope: "following",
        Icon: CalendarRange,
        label: "This and all later sittings",
        hint: "Sittings from here onward are removed.",
      },
      {
        scope: "series",
        Icon: CalendarDays,
        label: "All sittings",
        hint: "Delete the task and every sitting.",
        destructive: true,
      },
    ],
  },
};

/**
 * "Delete which part of this series?" — the web counterpart of
 * `mobile/components/tasks/delete-recurring-sheet.tsx`. Opened from the edit
 * dialog's Delete button when the session belongs to a series; a one-off
 * session deletes with no prompt.
 */
export function DeleteRecurringDialog({
  open,
  onOpenChange,
  kind,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Exclude<SeriesKind, "none">;
  onChoose: (scope: DeleteRecurringScope) => void;
}) {
  const { title, options } = COPY[kind];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose how much of the series to remove.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map(({ scope, Icon, label, hint, destructive }) => (
            <button
              key={scope}
              type="button"
              onClick={() => {
                onChoose(scope);
                onOpenChange(false);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                destructive
                  ? "border-destructive/35 bg-destructive/5 hover:bg-destructive/10"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  destructive ? "bg-destructive/15" : "bg-muted",
                )}
              >
                <Icon
                  className={cn(
                    "size-4",
                    destructive ? "text-destructive" : "text-muted-foreground",
                  )}
                />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm font-semibold",
                    destructive ? "text-destructive" : "text-foreground",
                  )}
                >
                  {label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
