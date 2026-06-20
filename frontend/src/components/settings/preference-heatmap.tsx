import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { Loader2, Sparkles } from "lucide-react";
import { getPreferenceMatrix } from "@/api/users";
import { minutesToLabel } from "@/components/settings/preferences-fields";
import { cn } from "@/lib/utils";
import type { PreferenceMatrixResponse } from "@/types/phase2";

/** ISO-weekday row labels (1=Mon … 7=Sun), matching the matrix's day index. */
const ROW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Hours we label along the top axis (every 3h reads cleanly at this cell size). */
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

/** GitHub-contribution-style cell geometry (px). Shared by cells + axis ticks. */
const CELL = 14;
const GAP = 3;
const STEP = CELL + GAP;
/** 4 fifteen-minute blocks per hour. */
const BLOCKS_PER_HOUR = 4;

/**
 * Discrete diverging scale: positive (preferred) scores climb an orange ramp,
 * negative (avoided) scores climb a blue ramp, both deepening with magnitude
 * relative to the matrix's peak. A zero / cold cell reads as neutral. Full
 * literal class names so Tailwind's scanner emits them.
 */
const ORANGE_SCALE = [
  "bg-orange-100",
  "bg-orange-200",
  "bg-orange-300",
  "bg-orange-400",
  "bg-orange-500",
  "bg-orange-600",
  "bg-orange-700",
  "bg-orange-800",
  "bg-orange-900",
];
const BLUE_SCALE = [
  "bg-blue-100",
  "bg-blue-200",
  "bg-blue-300",
  "bg-blue-400",
  "bg-blue-500",
  "bg-blue-600",
  "bg-blue-700",
  "bg-blue-800",
  "bg-blue-900",
];
const NEUTRAL_CLASS = "bg-muted";

function cellClass(score: number, peak: number) {
  if (score === 0 || peak === 0) return NEUTRAL_CLASS;
  const intensity = Math.min(1, Math.abs(score) / peak);
  // intensity in (0,1] → step 0..8 (at least the lightest shade when nonzero).
  const step = Math.min(8, Math.max(0, Math.ceil(intensity * 9) - 1));
  return score > 0 ? ORANGE_SCALE[step] : BLUE_SCALE[step];
}

/**
 * 7×96 signed-preference heatmap for the Settings → Insights tab. Fetches the
 * matrix on mount (the tab only mounts this when opened, satisfying the
 * fetch-on-open contract) and degrades gracefully for a cold-start user whose
 * matrix is all zeros.
 */
export function PreferenceHeatmap() {
  const [data, setData] = useState<PreferenceMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getPreferenceMatrix()
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive)
          setError(
            (isAxiosError(e) && e.response?.data?.message) ||
              "Couldn't load your preference map",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
        {error}
      </div>
    );
  }

  const matrix = data?.matrix ?? [];
  const days = data?.days ?? 7;
  const blocks = data?.blocks ?? 96;
  const peak = matrix.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

  // Cold start: the matrix exists but carries no signal yet.
  if (peak === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
          <Sparkles className="size-4 text-primary" />
        </span>
        <p className="text-sm font-semibold">No preferences learned yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          As you move and resize tasks, Zenflow learns when you like to work.
          Your preference map will fill in here over the next few weeks.
        </p>
      </div>
    );
  }

  const gridWidth = blocks * STEP - GAP;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {/* Pinned day-label gutter — stays put while the grid scrolls. */}
        <div className="flex shrink-0 flex-col" style={{ gap: GAP }}>
          {/* Spacer aligning the labels below the hour-tick row. */}
          <div className="h-4" />
          {Array.from({ length: days }).map((_, d) => (
            <span
              key={d}
              className="flex items-center text-[11px] font-medium text-muted-foreground"
              style={{ height: CELL }}
            >
              {ROW_LABELS[d] ?? `D${d + 1}`}
            </span>
          ))}
        </div>

        {/* Horizontally scrollable grid (96 fifteen-minute columns). */}
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div style={{ width: gridWidth }}>
            {/* Hour axis ticks */}
            <div className="relative h-4">
              {HOUR_TICKS.map((h) => (
                <span
                  key={h}
                  className="absolute top-0 text-[10px] tabular-nums text-muted-foreground"
                  style={{ left: h * BLOCKS_PER_HOUR * STEP }}
                >
                  {minutesToLabel(h * 60)}
                </span>
              ))}
            </div>

            {/* Cells */}
            <div className="flex flex-col" style={{ gap: GAP }}>
              {Array.from({ length: days }).map((_, d) => (
                <div key={d} className="flex" style={{ gap: GAP }}>
                  {Array.from({ length: blocks }).map((__, b) => {
                    const score = matrix[d * blocks + b] ?? 0;
                    return (
                      <div
                        key={`${d}:${b}`}
                        className={cn(
                          "rounded-[3px] border border-border/60 transition-shadow hover:ring-1 hover:ring-ring",
                          cellClass(score, peak),
                        )}
                        style={{ width: CELL, height: CELL }}
                        title={`${ROW_LABELS[d] ?? `Day ${d + 1}`} ${minutesToLabel(
                          b * 15,
                        )} · score ${score > 0 ? "+" : ""}${score}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          Avoid
          <span className="flex gap-1">
            {[2, 4, 6, 8].map((s) => (
              <span
                key={s}
                className={cn("inline-block h-3 w-3 rounded-[3px]", BLUE_SCALE[s])}
              />
            ))}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-[3px] border border-border/60 bg-muted" />
          Neutral
        </span>
        <span className="flex items-center gap-1.5">
          <span className="flex gap-1">
            {[2, 4, 6, 8].map((s) => (
              <span
                key={s}
                className={cn(
                  "inline-block h-3 w-3 rounded-[3px]",
                  ORANGE_SCALE[s],
                )}
              />
            ))}
          </span>
          Prefer
        </span>
      </div>
    </div>
  );
}
