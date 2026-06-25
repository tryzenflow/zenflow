import { cn } from "@/lib/utils";
import { Sparkles, MessageCircleQuestion, MinusCircle } from "lucide-react";
import type { DurationAdjustmentMode } from "@/types/phase2";

/** The three duration-corrector UX modes, with copy for the radio control. */
export const DURATION_MODES: {
  id: DurationAdjustmentMode;
  name: string;
  blurb: string;
  icon: typeof Sparkles;
}[] = [
  {
    id: "auto",
    name: "Automatic",
    blurb:
      "Apply the learned duration and let me undo it. Best once Zenflow knows your pace.",
    icon: Sparkles,
  },
  {
    id: "ask",
    name: "Ask first",
    blurb: "Show the suggestion and let me accept it or keep my estimate.",
    icon: MessageCircleQuestion,
  },
  {
    id: "never",
    name: "Never",
    blurb: "Always use the duration I type. Zenflow still learns in the background.",
    icon: MinusCircle,
  },
];

/**
 * Radio-style selector for the `auto | ask | never` duration-adjustment mode.
 * Shared between the Settings "Scheduling" tab and the onboarding wizard so the
 * copy and visuals stay in lockstep.
 */
export function DurationModeField({
  value,
  onChange,
}: {
  value: DurationAdjustmentMode;
  onChange: (mode: DurationAdjustmentMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Duration adjustment mode"
      className="space-y-2"
    >
      {DURATION_MODES.map((m) => {
        const on = value === m.id;
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.id)}
            data-testid={`duration-mode-${m.id}`}
            className={cn(
              "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
              on
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary/50",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                on
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{m.name}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {m.blurb}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
