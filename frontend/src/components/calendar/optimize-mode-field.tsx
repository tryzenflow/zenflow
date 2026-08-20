import { cn } from "@/lib/utils";
import { Scale, RefreshCcw, Lock } from "lucide-react";
import type { OptimizeWindowInput } from "@zenflow/shared";

export type OptimizeMode = OptimizeWindowInput["mode"];

/** The three Optimize modes, with copy for the radio control. Mode 3
 * ("balanced") is the one-click recommended default. */
export const OPTIMIZE_MODES: {
  id: OptimizeMode;
  name: string;
  blurb: string;
  icon: typeof Scale;
}[] = [
  {
    id: "balanced",
    name: "Balanced",
    blurb: "Recommended. Repacks tasks while favoring your near-tied preferences.",
    icon: Scale,
  },
  {
    id: "full",
    name: "Full reflow",
    blurb: "Repacks every pending task in the window, including manual placements.",
    icon: RefreshCcw,
  },
  {
    id: "retainManual",
    name: "Retain manual placements",
    blurb: "Repacks auto-placed tasks only — manually moved tasks stay put.",
    icon: Lock,
  },
];

/**
 * Radio-style selector for the Optimize `balanced | full | retainManual`
 * mode: one button per option with an icon + name + blurb.
 */
export function OptimizeModeField({
  value,
  onChange,
}: {
  value: OptimizeMode;
  onChange: (mode: OptimizeMode) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Optimize mode" className="space-y-1.5">
      {OPTIMIZE_MODES.map((m) => {
        const on = value === m.id;
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.id)}
            data-testid={`optimize-mode-${m.id}`}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors",
              on
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary/50",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                on
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{m.name}</span>
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
