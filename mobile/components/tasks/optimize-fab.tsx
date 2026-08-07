import { optimizeApply, optimizePreview, undoBatch } from "@/api/tasks";
import { ChevronDown, ChevronUp, Sparkles } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetOpenTrigger,
  BottomSheetScrollView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useScheduleRefresh } from "@/hooks/use-schedule-refresh";
import { FAB_GLOW_INNER, FAB_GLOW_OUTER } from "@/lib/fab-glow";
import { zonedNow, zonedWallClockToUtc } from "@zenflow/core";
import {
  OPTIMIZE_LARGE_BATCH_THRESHOLD,
  OPTIMIZE_UI_MAX_WINDOW_DAYS,
  type OptimizeApplyResponse,
  type OptimizeWindowInput,
} from "@zenflow/shared";
import { isAxiosError } from "axios";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InlineDateField } from "./form/inline-date-field";
import { OPTIMIZE_MODES, OptimizeModeField } from "./optimize-mode-field";

type OptimizeMode = OptimizeWindowInput["mode"];

const DEFAULT_MODE: OptimizeMode = "balanced";
const DEFAULT_WINDOW_DAYS = 7;

type Step = "form" | "confirmLarge" | "result";

/** Zero out the time-of-day fields on an already-zoned (user-tz wall-clock)
 * `Date` — mirrors `deadline-chip-row.tsx`'s `dayAnchor` helper. */
function dayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Last selectable minute of a zoned day, for an inclusive end-of-range bound. */
function dayEnd(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return d;
}

function errorMessage(error: unknown, fallback: string): string {
  return (
    (isAxiosError(error) &&
      (error.response?.data as { message?: string } | undefined)?.message) ||
    fallback
  );
}

/**
 * "Optimize" button + bottom sheet — the mobile entry point for the
 * scheduler redesign's one explicit, opt-in, previewable-by-count multi-task
 * action (see the scheduler redesign plan's "Mobile" file-level changes).
 * Unlike `CreateTaskFab`, which just navigates, this owns its own
 * `@gorhom/bottom-sheet` sheet directly (same infra `InlineDateField`
 * already uses).
 *
 * This renders only the button itself — no positioning. It used to be a
 * floating FAB rendered by Day/Week/Month individually; it now lives in the
 * centre of the tab bar (`components/tab-bar.tsx`), which owns its placement
 * on the convex hump. Because the tab bar is mounted once outside every
 * screen, the apply/undo result reaches the focused screen through
 * `useScheduleRefresh` rather than an `onApplied` prop.
 *
 * No per-task diff/preview UI is ever rendered here — deliberately ruled out
 * by the plan. `optimizePreview` only returns a count, used to decide
 * whether to show the large-batch guard (`OPTIMIZE_LARGE_BATCH_THRESHOLD`)
 * before calling `optimizeApply`. The apply result (count + range + Undo)
 * renders in this same sheet as a second/third step, rather than via
 * `components/ui/toast.tsx` — that toast system is string+variant only and
 * can't host an Undo button; building a rich-body toast variant was ruled
 * out of scope for this change.
 */
export function OptimizeFab({
  tz,
  size = 56,
}: {
  tz: string;
  /** Diameter of the circular trigger. */
  size?: number;
}) {
  const bottomSheet = useBottomSheet();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const onApplied = useScheduleRefresh((s) => s.bump);

  const [step, setStep] = useState<Step>("form");
  const [mode, setMode] = useState<OptimizeMode>(DEFAULT_MODE);
  const [showModeOptions, setShowModeOptions] = useState(false);
  const [windowStart, setWindowStart] = useState<Date>(() =>
    dayStart(zonedNow(tz)),
  );
  const [windowEnd, setWindowEnd] = useState<Date>(() =>
    addDays(dayStart(zonedNow(tz)), DEFAULT_WINDOW_DAYS),
  );
  const [submitting, setSubmitting] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [applyResult, setApplyResult] = useState<OptimizeApplyResponse | null>(
    null,
  );
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);

  function reset() {
    const today = dayStart(zonedNow(tz));
    setStep("form");
    setMode(DEFAULT_MODE);
    setShowModeOptions(false);
    setWindowStart(today);
    setWindowEnd(addDays(today, DEFAULT_WINDOW_DAYS));
    setSubmitting(false);
    setPreviewCount(null);
    setApplyResult(null);
    setUndoing(false);
    setUndone(false);
  }

  function handleOpen() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    reset();
  }

  function handleStartChange(date: Date) {
    const next = dayStart(date);
    setWindowStart(next);
    const cap = addDays(next, OPTIMIZE_UI_MAX_WINDOW_DAYS);
    if (windowEnd < next) setWindowEnd(addDays(next, DEFAULT_WINDOW_DAYS));
    else if (windowEnd > cap) setWindowEnd(cap);
  }

  function handleEndChange(date: Date) {
    const next = dayStart(date);
    if (next < windowStart) return;
    const cap = addDays(windowStart, OPTIMIZE_UI_MAX_WINDOW_DAYS);
    setWindowEnd(next > cap ? cap : next);
  }

  function buildInput(): OptimizeWindowInput {
    return {
      windowStart: zonedWallClockToUtc(windowStart, tz).toISOString(),
      windowEnd: zonedWallClockToUtc(dayEnd(windowEnd), tz).toISOString(),
      mode,
    };
  }

  async function applyNow(input: OptimizeWindowInput) {
    const result = await optimizeApply(input);
    setApplyResult(result);
    setStep("result");
    onApplied?.();
  }

  async function handleOptimizePress() {
    setSubmitting(true);
    try {
      const input = buildInput();
      const preview = await optimizePreview(input);
      if (preview.count > OPTIMIZE_LARGE_BATCH_THRESHOLD) {
        setPreviewCount(preview.count);
        setStep("confirmLarge");
        return;
      }
      await applyNow(input);
    } catch (error) {
      toast(
        errorMessage(error, "Couldn't preview the schedule"),
        "destructive",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmLarge() {
    setSubmitting(true);
    try {
      await applyNow(buildInput());
    } catch (error) {
      toast(
        errorMessage(error, "Couldn't optimize the schedule"),
        "destructive",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUndo() {
    if (!applyResult?.batchId) return;
    setUndoing(true);
    try {
      const res = await undoBatch(applyResult.batchId);
      if (res.requiresConfirmation) {
        // This batch is from the same sheet session, so a "touched since"
        // row can only mean the user acted elsewhere while this sheet was
        // open — revert everything else and leave those rows alone rather
        // than silently overwriting whatever they just did.
        await undoBatch(applyResult.batchId, "excludeTouched");
      }
      onApplied?.();
      setUndone(true);
    } catch (error) {
      toast(errorMessage(error, "Couldn't undo"), "destructive");
    } finally {
      setUndoing(false);
    }
  }

  // Bounds passed to the "From"/"To" `InlineDateField`s so the picker itself
  // never offers a past date or a span over `OPTIMIZE_UI_MAX_WINDOW_DAYS` —
  // matches `handleStartChange`/`handleEndChange`'s own capping so the UI
  // and the clamp logic never disagree.
  const todayStart = dayStart(zonedNow(tz));
  const maxWindowStart = addDays(todayStart, OPTIMIZE_UI_MAX_WINDOW_DAYS);
  const maxWindowEnd = addDays(windowStart, OPTIMIZE_UI_MAX_WINDOW_DAYS);

  const rangeLabel = `${format(windowStart, "MMM d")} – ${format(
    windowEnd,
    "MMM d",
  )}`;
  const rangeDays = Math.max(
    1,
    differenceInCalendarDays(windowEnd, windowStart) + 1,
  );
  const selectedModeOption = OPTIMIZE_MODES.find((m) => m.id === mode);

  /**
   * Plain function returning JSX (not threaded through gorhom's
   * `footerComponent` render-prop) — see this file's own note above
   * `<BottomSheetContent>` below for why. Rendered as a normal flexbox
   * sibling of the scroll view instead.
   */
  function renderFooter() {
    if (step === "form") {
      return (
        <Button
          className="h-[52px] w-full"
          disabled={submitting}
          onPress={handleOptimizePress}
        >
          <Text className="text-base font-semibold text-primary-foreground">
            {submitting ? "Checking…" : "Optimize"}
          </Text>
        </Button>
      );
    }
    if (step === "confirmLarge") {
      return (
        <View className="w-full flex-row gap-2">
          <Button
            variant="outline"
            className="h-[52px] flex-1"
            disabled={submitting}
            onPress={() => setStep("form")}
          >
            <Text className="text-base font-semibold">Cancel</Text>
          </Button>
          <Button
            className="h-[52px] flex-1"
            disabled={submitting}
            onPress={handleConfirmLarge}
          >
            <Text className="text-base font-semibold text-primary-foreground">
              {submitting ? "Optimizing…" : "Reschedule"}
            </Text>
          </Button>
        </View>
      );
    }
    return (
      <Button
        className="h-[52px] w-full"
        variant="outline"
        onPress={() => bottomSheet.close()}
      >
        <Text className="text-base font-semibold">Done</Text>
      </Button>
    );
  }

  return (
    <View style={[FAB_GLOW_OUTER, { borderRadius: 999 }]}>
      <BottomSheet>
        <BottomSheetOpenTrigger asChild onPress={handleOpen}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Optimize schedule"
            style={[
              FAB_GLOW_INNER,
              { width: size, height: size, borderRadius: 999 },
            ]}
          >
            <LinearGradient
              colors={["rgb(255,142,62)", "rgb(240,177,1)", "rgb(216,249,152)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                flex: 1,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={Math.round(size * 0.45)} color="white" />
            </LinearGradient>
          </Pressable>
        </BottomSheetOpenTrigger>
        <BottomSheetContent
          ref={bottomSheet.ref}
          enableDynamicSizing={false}
          snapPoints={["80%"]}
        >
          <BottomSheetHeader>
            <Text className="text-[17px] font-bold tracking-tight">
              Optimize schedule
            </Text>
          </BottomSheetHeader>
          <View className="flex-1">
            <BottomSheetScrollView
              className="flex-1 px-5 pt-3"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {step === "form" && (
                <View className="gap-4 pb-2">
                  <Text className="text-[13px] text-muted-foreground">
                    Reflow pending tasks in a date range. Nothing outside it
                    moves.
                  </Text>

                  <View className="flex-row gap-2">
                    <View className="flex-1 gap-1">
                      <Text className="text-[12px] font-medium text-muted-foreground">
                        From
                      </Text>
                      <InlineDateField
                        value={windowStart}
                        onChange={handleStartChange}
                        tz={tz}
                        disabled={submitting}
                        minDate={todayStart}
                        maxDate={maxWindowStart}
                      />
                    </View>
                    <View className="flex-1 gap-1">
                      <Text className="text-[12px] font-medium text-muted-foreground">
                        To
                      </Text>
                      <InlineDateField
                        value={windowEnd}
                        onChange={handleEndChange}
                        tz={tz}
                        disabled={submitting}
                        minDate={windowStart}
                        maxDate={maxWindowEnd}
                      />
                    </View>
                  </View>
                  <Text className="text-[11px] text-muted-foreground">
                    {rangeDays} day{rangeDays === 1 ? "" : "s"} · up to{" "}
                    {OPTIMIZE_UI_MAX_WINDOW_DAYS} days
                  </Text>

                  <OptimizeModeField value={mode} onChange={setMode} />
                </View>
              )}

              {step === "confirmLarge" && (
                <View className="gap-2 pb-2">
                  <Text className="text-[15px] font-semibold text-foreground">
                    Reschedule ~{previewCount} tasks in this range?
                  </Text>
                  <Text className="text-[13px] text-muted-foreground">
                    {rangeLabel} · {selectedModeOption?.name}
                  </Text>
                </View>
              )}

              {step === "result" && applyResult && (
                <View className="gap-2 pb-2">
                  <Text className="text-[15px] font-semibold text-foreground">
                    {applyResult.count === 0
                      ? "Nothing needed rescheduling"
                      : `Rescheduled ${applyResult.count} task${
                          applyResult.count === 1 ? "" : "s"
                        }`}
                  </Text>
                  <Text className="text-[13px] text-muted-foreground">
                    {rangeLabel}
                  </Text>
                  {(applyResult.fixedCount != null ||
                    applyResult.unchangedCount != null) && (
                    <Text className="text-[12px] text-muted-foreground">
                      Fixed {applyResult.fixedCount ?? 0} ·{" "}
                      {applyResult.unchangedCount ?? 0} left unchanged (manually
                      placed)
                    </Text>
                  )}
                  {undone ? (
                    <Text className="text-[12.5px] font-medium text-emerald-600">
                      Undone
                    </Text>
                  ) : (
                    applyResult.batchId && (
                      <Pressable
                        onPress={handleUndo}
                        disabled={undoing}
                        className="mt-1 self-start rounded-full border border-border px-3 py-1.5"
                      >
                        <Text className="text-[12.5px] font-semibold text-foreground">
                          {undoing ? "Undoing…" : "Undo"}
                        </Text>
                      </Pressable>
                    )
                  )}
                </View>
              )}
            </BottomSheetScrollView>
          </View>
          <View
            className="flex-row border-t border-border bg-background px-4 pt-1.5 shadow-lg shadow-primary/10"
            style={{ paddingBottom: insets.bottom + 6 }}
          >
            {renderFooter()}
          </View>
        </BottomSheetContent>
      </BottomSheet>
    </View>
  );
}
