import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { ActivityIndicator, Pressable, View } from "react-native";
import type {
  PreferenceMatrixResponse,
  TagBiasResponse,
} from "@zenflow/shared";
import { Text } from "@/components/ui/text";
import { Sparkles, Tag } from "@/components/Icons";
import { getPreferenceMatrix, getTagBias } from "@/api/users";
import { cn } from "@/lib/utils";

const COL_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = 24;
const DEFAULT_VISIBLE = 5;
const GUTTER = 34;

/** Compact hour label, e.g. "9 AM", "12 PM". */
function hourLabel(h: number) {
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

/** Discrete positive-intensity ramp; literal class names so NativeWind's scanner emits them. */
const SCALE = [
  "bg-lime-100",
  "bg-lime-200",
  "bg-lime-300",
  "bg-lime-400",
  "bg-lime-500",
  "bg-lime-600",
  "bg-lime-700",
  "bg-lime-800",
  "bg-lime-900",
];

const NEUTRAL_CLASS = "bg-muted";

function cellClass(score: number, peak: number) {
  if (score <= 0 || peak === 0) return NEUTRAL_CLASS;
  const intensity = Math.min(1, Math.abs(score) / peak);
  const step = Math.min(8, Math.max(0, Math.ceil(intensity * 9) - 1));
  return SCALE[step];
}

/**
 * Badge colour for a duration multiplier:
 * - orange  → user tends to underestimate (b > 1.1)
 * - blue    → user tends to overestimate  (b < 0.9)
 * - neutral → within ±10% of estimate
 */
function biasClass(b: number): string {
  if (b > 1.1) return "bg-orange-50 text-orange-600 dark:bg-orange-600 dark:text-orange-200";
  if (b < 0.9) return "bg-blue-50 text-blue-600 dark:bg-blue-600 dark:text-blue-200";
  return "bg-muted text-muted-foreground";
}

/**
 * Preference heatmap + per-tag duration-multiplier panel for Settings →
 * Insights (port of frontend/src/components/settings/preferences.tsx). Both
 * sections fetch-on-mount independently and degrade gracefully.
 */
export function InsightsPanel() {
  const [heatmap, setHeatmap] = useState<PreferenceMatrixResponse | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(true);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);

  const [bias, setBias] = useState<TagBiasResponse | null>(null);
  const [biasLoading, setBiasLoading] = useState(true);
  const [biasError, setBiasError] = useState<string | null>(null);
  const [biasExpanded, setBiasExpanded] = useState(false);

  useEffect(() => {
    let alive = true;

    setHeatmapLoading(true);
    getPreferenceMatrix()
      .then((res) => alive && setHeatmap(res))
      .catch((e) => {
        if (alive) {
          setHeatmapError(
            (isAxiosError(e) && e.response?.data?.message) ||
              "Couldn't load your preference map",
          );
        }
      })
      .finally(() => alive && setHeatmapLoading(false));

    setBiasLoading(true);
    getTagBias()
      .then((res) => alive && setBias(res))
      .catch((e) => {
        if (alive) {
          setBiasError(
            (isAxiosError(e) && e.response?.data?.message) ||
              "Couldn't load tag bias data",
          );
        }
      })
      .finally(() => alive && setBiasLoading(false));

    return () => {
      alive = false;
    };
  }, []);

  const matrix = heatmap?.matrix ?? [];
  const days = heatmap?.days ?? 7;
  const blocks = heatmap?.blocks ?? 24;
  function hourScore(d: number, h: number) {
    return h < blocks ? (matrix[d * blocks + h] ?? 0) : 0;
  }
  let peak = 0;
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < HOURS; h++)
      peak = Math.max(peak, Math.abs(hourScore(d, h)));
  }

  const tags = bias?.tags ?? [];
  const visibleTags = biasExpanded ? tags : tags.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = tags.length - DEFAULT_VISIBLE;

  return (
    <View className="gap-[22px]">
      {/* Preference heatmap */}
      <View>
        {heatmapLoading ? (
          <View className="h-40 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : heatmapError ? (
          <Text className="rounded-xl border border-border bg-muted/40 p-3.5 text-xs text-muted-foreground">
            {heatmapError}
          </Text>
        ) : peak === 0 ? (
          <View className="items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-6">
            <View className="h-9 w-9 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
              <Sparkles size={16} className="text-primary" />
            </View>
            <Text className="text-center text-[14px] font-semibold">
              No preferences learned yet
            </Text>
            <Text className="text-center text-xs leading-snug text-muted-foreground">
              As you move and resize tasks, Zenflow learns when you like to
              work. Your preference map fills in here over time.
            </Text>
          </View>
        ) : (
          <View className="gap-2.5">
            <View className="flex-row items-center justify-center gap-4">
              <View className="flex-row items-center gap-1.5">
                <View className="h-4 w-4 rounded-sm bg-muted" />
                <Text className="text-xs text-muted-foreground">Neutral</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <View className="flex-row gap-1">
                  {[2, 4, 6, 8].map((s) => (
                    <View
                      key={s}
                      className={cn("h-4 w-4 rounded-sm", SCALE[s])}
                    />
                  ))}
                </View>
                <Text className="text-xs text-muted-foreground">Prefer</Text>
              </View>
            </View>
            <View className="flex-row" style={{ gap: 2 }}>
              <View className="shrink-0" style={{ width: GUTTER }} />
              {COL_LABELS.map((label) => (
                <Text
                  key={label}
                  className="flex-1 text-center text-[10px] font-medium text-muted-foreground"
                >
                  {label}
                </Text>
              ))}
            </View>
            <View style={{ gap: 2 }}>
              {Array.from({ length: HOURS }).map((_, h) => (
                <View
                  key={h}
                  className="flex-row items-center"
                  style={{ gap: 2 }}
                >
                  <Text
                    className="shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                    style={{ width: GUTTER }}
                  >
                    {hourLabel(h)}
                  </Text>
                  {Array.from({ length: days }).map((_, d) => (
                    <View
                      key={d}
                      className={cn(
                        "h-4 flex-1 rounded-[2px]",
                        cellClass(hourScore(d, h), peak),
                      )}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Duration multipliers by tag */}
      <View className="gap-2.5 border-t border-border pt-[18px]">
        <View>
          <Text className="text-[14px] font-semibold">
            Duration multipliers by tag
          </Text>
          <Text className="mt-0.5 text-xs leading-snug text-muted-foreground">
            How long your tasks actually take vs. your estimate. {">"}1× means
            you tend to underestimate.
          </Text>
        </View>

        {biasLoading ? (
          <View className="h-16 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : biasError ? (
          <Text className="rounded-xl border border-border bg-muted/40 p-3.5 text-xs text-muted-foreground">
            {biasError}
          </Text>
        ) : tags.length === 0 ? (
          <View className="items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-6">
            <View className="h-9 w-9 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
              <Tag size={16} className="text-primary" />
            </View>
            <Text className="text-center text-[14px] font-semibold">
              No tag history yet
            </Text>
            <Text className="text-center text-xs leading-snug text-muted-foreground">
              Complete a few tagged tasks and Zenflow will learn how long each
              type of work really takes for you.
            </Text>
          </View>
        ) : (
          <View className="gap-1.5">
            {visibleTags.map((entry) => (
              <View
                key={entry.tag}
                className="flex-row items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5"
              >
                <Text className="text-sm font-medium">
                  <Text className="text-muted-foreground">#</Text>
                  {entry.tag}
                </Text>
                <View className="flex-row items-center gap-2">
                  <Text
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-semibold",
                      biasClass(entry.b),
                    )}
                  >
                    {entry.b.toFixed(1)}×
                  </Text>
                  <Text className="text-[11px] text-muted-foreground">
                    {entry.n} {entry.n === 1 ? "task" : "tasks"}
                  </Text>
                </View>
              </View>
            ))}
            {hiddenCount > 0 && (
              <Pressable
                onPress={() => setBiasExpanded((v) => !v)}
                className="py-1"
              >
                <Text className="text-xs font-medium text-muted-foreground underline">
                  {biasExpanded ? "Show less" : `Show ${hiddenCount} more`}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
