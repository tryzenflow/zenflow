import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { Loader2, Sparkles } from "lucide-react";
import { getPreferenceMatrix } from "@/api/users";
import { cn } from "@/lib/utils";
import type { PreferenceMatrixResponse } from "@/types/phase2";

/** Column labels — ISO weekdays 1=Mon … 7=Sun, matching the matrix's day index. */
const COL_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Rows are the 24 hours of the day; 4 fifteen-minute blocks make up each hour. */
const HOURS = 24;
const BLOCKS_PER_HOUR = 4;
/** Row height (px) and inter-cell gap; the hour-label gutter width. */
const ROW_H = 22;
const GAP = 3;
const GUTTER = 46;

/** Compact hour label, e.g. "9 AM", "12 PM". */
function hourLabel(h: number) {
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

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
 * Preference heatmap for the Settings → Insights tab, oriented as a week grid:
 * 24 hourly rows × 7 day columns. Each hour cell is the mean of its four
 * fifteen-minute blocks (:00/:15/:30/:45) from the underlying 7×96 signed
 * matrix. Fetches on mount (the tab only mounts this when opened → fetch-on-open)
 * and degrades gracefully for a cold-start user whose matrix is all zeros.
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

  /** Mean signed score of hour `h`'s four blocks for day column `d`. */
  function hourScore(d: number, h: number) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < BLOCKS_PER_HOUR; k++) {
      const b = h * BLOCKS_PER_HOUR + k;
      if (b < blocks) {
        sum += matrix[d * blocks + b] ?? 0;
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  let peak = 0;
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < HOURS; h++) {
      peak = Math.max(peak, Math.abs(hourScore(d, h)));
    }
  }

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
      {/* Legend (top) */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          Avoid
          <span className="flex gap-px">
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
          <span className="flex gap-px">
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

      {/* Day-column header */}
      <div className="flex" style={{ gap: GAP }}>
        <div className="shrink-0" style={{ width: GUTTER }} />
        {Array.from({ length: days }).map((_, d) => (
          <div
            key={d}
            className="flex-1 text-center text-[11px] font-medium text-muted-foreground"
          >
            {COL_LABELS[d] ?? `D${d + 1}`}
          </div>
        ))}
      </div>

      {/* Hour rows × day columns */}
      <div className="flex flex-col" style={{ gap: GAP }}>
        {Array.from({ length: HOURS }).map((_, h) => (
          <div key={h} className="flex items-center" style={{ gap: GAP }}>
            <div
              className="shrink-0 pr-1 text-right text-[10px] tabular-nums leading-none text-muted-foreground"
              style={{ width: GUTTER }}
            >
              {hourLabel(h)}
            </div>
            {Array.from({ length: days }).map((_, d) => {
              const score = hourScore(d, h);
              return (
                <div
                  key={d}
                  className={cn(
                    "flex-1 rounded-[3px] border border-border/60 transition-shadow hover:ring-1 hover:ring-ring",
                    cellClass(score, peak),
                  )}
                  style={{ height: ROW_H }}
                  title={`${COL_LABELS[d] ?? `Day ${d + 1}`} ${hourLabel(
                    h,
                  )} · avg ${score > 0 ? "+" : ""}${score.toFixed(1)}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
