import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { Loader2, Sparkles } from "lucide-react";
import { getPreferenceMatrix } from "@/api/users";
import { minutesToLabel } from "@/components/settings/preferences-fields";
import { cn } from "@/lib/utils";
import type { PreferenceMatrixResponse } from "@/types/phase2";

/** ISO-weekday row labels (1=Mon … 7=Sun), matching the matrix's day index. */
const ROW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Hour columns we draw axis ticks at (every 4 blocks = 1 hour is too dense). */
const HOUR_TICKS = [0, 6, 12, 18];

/**
 * Map a signed cell score to a diverging fill. Positive (preferred) scores warm
 * toward the amber accent; negative (avoided) scores cool toward slate. Opacity
 * scales with magnitude relative to the matrix's peak so a flat matrix reads
 * faint rather than saturated.
 */
function cellColor(score: number, peak: number) {
  if (score === 0 || peak === 0) return "transparent";
  const intensity = Math.min(1, Math.abs(score) / peak);
  const alpha = 0.12 + intensity * 0.78;
  return score > 0
    ? `oklch(0.769 0.188 70.08 / ${alpha})` // amber — preferred
    : `oklch(0.55 0.05 255 / ${alpha})`; // cool slate — avoided
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

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {/* Row label gutter */}
        <div className="flex flex-col justify-around pr-1 pt-0">
          {Array.from({ length: days }).map((_, d) => (
            <span
              key={d}
              className="text-[9px] font-medium leading-none text-muted-foreground"
            >
              {ROW_LABELS[d] ?? `D${d + 1}`}
            </span>
          ))}
        </div>

        {/* Grid */}
        <div className="min-w-0 flex-1">
          <div
            className="grid gap-px rounded-sm border border-border bg-border"
            style={{
              gridTemplateColumns: `repeat(${blocks}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: days }).flatMap((_, d) =>
              Array.from({ length: blocks }).map((__, b) => {
                const score = matrix[d * blocks + b] ?? 0;
                return (
                  <div
                    key={`${d}:${b}`}
                    className="aspect-square bg-card"
                    style={{ backgroundColor: cellColor(score, peak) }}
                    title={`${ROW_LABELS[d] ?? `Day ${d + 1}`} ${minutesToLabel(
                      b * 15,
                    )} · score ${score > 0 ? "+" : ""}${score}`}
                  />
                );
              }),
            )}
          </div>

          {/* Hour axis ticks */}
          <div className="relative mt-1 h-3">
            {HOUR_TICKS.map((h) => (
              <span
                key={h}
                className="absolute -translate-x-1/2 text-[9px] text-muted-foreground"
                style={{ left: `${((h * 4) / blocks) * 100}%` }}
              >
                {minutesToLabel(h * 60)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: cellColor(peak, peak) }}
          />
          Prefer
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: cellColor(-peak, peak) }}
          />
          Avoid
        </span>
        <span
          className={cn(
            "flex items-center gap-1.5",
          )}
        >
          <span className="inline-block h-3 w-3 rounded-sm border border-border bg-card" />
          Neutral
        </span>
      </div>
    </div>
  );
}
