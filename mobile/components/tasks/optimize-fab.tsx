import { optimizeApply, optimizePreview, undoBatch } from "@/api/tasks";
import { ChevronDown, ChevronUp, Sparkles } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetOpenTrigger,
  BottomSheetScrollView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { BottomSheetFooterProps } from "@gorhom/bottom-sheet";
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
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InlineDateField } from "./form/inline-date-field";

/**
 * Reserved bottom padding for the sheet's `BottomSheetScrollView`, so the
 * last row of content (the mode-options list, when expanded) never ends up
 * underneath the fixed `footerComponent`. `enableDynamicSizing={true}`
 * (this sheet's default, unlike `change-duration-sheet.tsx`'s fixed
 * `snapPoints`) sizes the sheet to its *scrollable content*, not the
 * content + footer combined — `@gorhom/bottom-sheet` renders the footer as
 * an absolutely-positioned overlay on top of that sized content, so without
 * this the footer just overlaps whatever's scrolled to the bottom. Mirrors
 * `BottomSheetView`'s own `BOTTOM_SHEET_HEADER_HEIGHT` reservation for the
 * *header* case (`components/ui/bottom-sheet.native.tsx`) — there's no
 * equivalent built-in for a footer, so it's computed here from this sheet's
 * actual footer layout: one 52px button, `pt-1.5` (6px) above it, and
 * `paddingBottom: insets.bottom + 6` below it (see `BottomSheetFooter`'s own
 * `style` in the shared file) — plus a little extra breathing room.
 */
const OPTIMIZE_FOOTER_HEIGHT = 52 + 6 + 6 + 16;

type OptimizeMode = OptimizeWindowInput["mode"];

/**
 * Mode 3 ("balanced") is the one-click default; the other two only show up
 * behind the "More options" disclosure below — mirrors the web toolbar
 * popover's Mode 3-default/secondary-disclosure pattern
 * (`frontend/src/components/calendar/header.tsx`).
 */
const MODE_OPTIONS: {
  id: OptimizeMode;
  label: string;
  description: string;
}[] = [
  {
    id: "balanced",
    label: "Balanced (recommended)",
    description: "Best overall fit; resists moving tasks that start soon.",
  },
  {
    id: "full",
    label: "Full reflow",
    description: "Re-places everything in the window for the tightest fit.",
  },
  {
    id: "retainManual",
    label: "Retain manually moved",
    description: "Keeps anything you've dragged or resized fixed in place.",
  },
];

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
 * Floating "Optimize" button + bottom sheet — the mobile entry point for the
 * scheduler redesign's one explicit, opt-in, previewable-by-count multi-task
 * action (see the scheduler redesign plan's "Mobile" file-level changes).
 * Rendered on Day/Week/Month the same way `CreateTaskFab` is (a
 * self-contained floating trigger, so it doesn't need those screens' stub
 * toolbars to exist first) — but unlike `CreateTaskFab`, which just
 * navigates, this owns its own `@gorhom/bottom-sheet` sheet directly (same
 * infra `InlineDateField`/`ChangeDurationSheet` already use).
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
  onApplied,
}: {
  tz: string;
  /** Called after a successful apply (and after a successful undo) so the
   * calling screen can refetch — same pattern as `ChangeDurationSheet`'s
   * `onResized`. Optional since `week.tsx`/`month.tsx` have no task list yet. */
  onApplied?: () => void;
}) {
  const bottomSheet = useBottomSheet();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();

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
  const selectedModeOption = MODE_OPTIONS.find((m) => m.id === mode);

  const renderFooter = useCallback(
    (footerProps: BottomSheetFooterProps) => (
      <BottomSheetFooter bottomSheetFooterProps={footerProps}>
        {step === "form" && (
          <Button
            className="h-[52px] w-full"
            disabled={submitting}
            onPress={handleOptimizePress}
          >
            <Text className="text-base font-semibold text-primary-foreground">
              {submitting ? "Checking…" : "Optimize"}
            </Text>
          </Button>
        )}
        {step === "confirmLarge" && (
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
        )}
        {step === "result" && (
          <Button
            className="h-[52px] w-full"
            variant="outline"
            onPress={() => bottomSheet.close()}
          >
            <Text className="text-base font-semibold">Done</Text>
          </Button>
        )}
      </BottomSheetFooter>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, submitting, windowStart, windowEnd, mode, previewCount],
  );

  return (
    <View className="absolute bottom-24 right-5">
      <BottomSheet>
        <BottomSheetOpenTrigger asChild onPress={handleOpen}>
          <Pressable style={{ width: 44, height: 44, borderRadius: 999 }}>
            <LinearGradient
              colors={["rgb(255,142,62)", "rgb(240,177,1)", "rgb(216,249,152)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={22} color="white" />
            </LinearGradient>
          </Pressable>
        </BottomSheetOpenTrigger>
        <BottomSheetContent
          ref={bottomSheet.ref}
          footerComponent={renderFooter}
        >
          <BottomSheetHeader className="px-5">
            <Text className="text-[17px] font-bold tracking-tight">
              Optimize schedule
            </Text>
          </BottomSheetHeader>
          <BottomSheetScrollView
            className="px-5 pt-3"
            contentContainerStyle={{
              paddingBottom: insets.bottom + OPTIMIZE_FOOTER_HEIGHT,
            }}
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

                <Pressable
                  onPress={() => setShowModeOptions((v) => !v)}
                  className="flex-row items-center justify-between rounded-xl border border-border bg-card px-3.5 py-3"
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-[13px] font-semibold text-foreground">
                      {selectedModeOption?.label}
                    </Text>
                    <Text className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {selectedModeOption?.description}
                    </Text>
                  </View>
                  {showModeOptions ? (
                    <ChevronUp
                      size={18}
                      className="shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <ChevronDown
                      size={18}
                      className="shrink-0 text-muted-foreground"
                    />
                  )}
                </Pressable>

                {showModeOptions && (
                  <View className="gap-2">
                    {MODE_OPTIONS.map((option) => (
                      <Pressable
                        key={option.id}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setMode(option.id);
                        }}
                        className={cn(
                          "rounded-xl border px-3.5 py-3",
                          mode === option.id
                            ? "border-primary bg-primary/10"
                            : "border-border bg-card",
                        )}
                      >
                        <Text
                          className={cn(
                            "text-[13px] font-semibold",
                            mode === option.id
                              ? "text-primary"
                              : "text-foreground",
                          )}
                        >
                          {option.label}
                        </Text>
                        <Text className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {option.description}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            {step === "confirmLarge" && (
              <View className="gap-2 pb-2">
                <Text className="text-[15px] font-semibold text-foreground">
                  Reschedule ~{previewCount} tasks in this range?
                </Text>
                <Text className="text-[13px] text-muted-foreground">
                  {rangeLabel} · {selectedModeOption?.label}
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
        </BottomSheetContent>
      </BottomSheet>
    </View>
  );
}
