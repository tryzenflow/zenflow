import type { DurationAdjustmentMode } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { completeOnboarding } from "@/api/users";
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Sparkles,
} from "@/components/Icons";
import { Logo } from "@/components/logo";
import { WorkDaysGrid } from "@/components/onboarding/work-days-grid";
import {
  DURATION_MODES,
  DurationModeField,
} from "@/components/settings/duration-mode-field";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TimePickerRow } from "@/components/ui/time-picker";
import { useToast } from "@/components/ui/toast";
import { useUserStore } from "@/hooks/use-user-store";
import { cacheSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  DAYS,
  isValidWindow,
  minutesToLabel,
  windowWraps,
  workWindowMinutes,
} from "@/utils/preferences";

const STEPS = ["Welcome", "Work Hours", "Work Days", "Adjustments", "All Set"];

const WELCOME_ROWS = [
  {
    title: "Schedules itself",
    body: "tasks fill your free time automatically.",
    icon: Clock,
  },
  {
    title: "Learns your pace",
    body: "durations get sharper over time.",
    icon: Sparkles,
  },
  {
    title: "Respects your hours",
    body: "nothing booked outside work time.",
    icon: Calendar,
  },
];

export default function OnboardingScreen() {
  const { toast } = useToast();
  const setUser = useUserStore((s) => s.setUser);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [workStart, setWorkStart] = useState(540);
  const [workEnd, setWorkEnd] = useState(1020);
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [durationMode, setDurationMode] =
    useState<DurationAdjustmentMode>("auto");

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  const hours = workWindowMinutes(workStart, workEnd) / 60;
  const validHours = isValidWindow(workStart, workEnd);
  const wraps = windowWraps(workStart, workEnd);

  function toggleDay(iso: number) {
    setWorkDays((d) =>
      d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort(),
    );
  }

  const canNext =
    (step === 1 && validHours) ||
    (step === 2 && workDays.length > 0) ||
    step === 0 ||
    step === 3 ||
    step === 4;

  async function finish() {
    setLoading(true);
    try {
      const updated = await completeOnboarding({
        workStart,
        workEnd,
        workDays,
        timezone,
        durationAdjustmentMode: durationMode,
      });
      setUser(updated);
      await cacheSessionUser(updated);
      toast("You're all set!", "success");
      // No manual navigation here: updating the store flips
      // `user.onboardingComplete`, and the root layout's `AuthGate` reacts
      // to that and redirects away from `(onboarding)` on its own. Calling
      // `router.replace` here too raced with that redirect (both targeting
      // "/" from inside this nested stack) and triggered a
      // "Maximum update depth exceeded" loop.
    } catch (error) {
      const message =
        (isAxiosError(error) && error.response?.data?.message) ||
        "Failed to complete onboarding";
      toast(message, "destructive");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 mt-4 px-4 pb-3 pt-1">
        <View className="w-full flex-row gap-1.5">
          {STEPS.map((_, i) => (
            <View
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= step ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </View>
        <View className="flex-row items-center gap-3">
          <Pressable
            disabled={step === 0 || loading}
            onPress={() => setStep((s) => Math.max(0, s - 1))}
            className={cn(
              "h-[38px] w-[38px] items-center justify-center rounded-xl",
              (step === 0 || loading) && "opacity-30",
            )}
          >
            <ChevronLeft size={19} className="text-foreground" />
          </Pressable>
          <Text className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerClassName="pb-8">
        {step === 0 && (
          <View className="items-center gap-4 px-1.5 pt-6 text-center">
            <Logo className="h-[72px] w-[72px]" />
            <Text className="text-center text-2xl font-bold tracking-tight">
              Welcome to Zenflow
            </Text>
            <Text className="max-w-[300px] text-center text-[15px] leading-[1.55] text-muted-foreground">
              A focus-first planner that schedules your work for you. Let's set
              up your working rhythm — it takes under a minute.
            </Text>
            <View className="mt-3 w-full divide-y divide-border rounded-2xl border border-border bg-card">
              {WELCOME_ROWS.map((row) => (
                <View
                  key={row.title}
                  className="flex-row items-center gap-3 px-3.5 py-[13px]"
                >
                  <View className="h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-brand-orange/14">
                    <row.icon size={20} className="text-brand-orange" />
                  </View>
                  <Text className="flex-1 text-[13px] leading-snug">
                    <Text className="text-[13px] font-semibold">
                      {row.title}
                    </Text>
                    <Text className="text-[13px] text-muted-foreground">
                      {" "}
                      — {row.body}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {step === 1 && (
          <View className="gap-3.5 pt-1">
            <View>
              <Text className="text-[23px] font-bold tracking-tight">
                When do you work?
              </Text>
              <Text className="mt-2 text-sm text-muted-foreground">
                Zenflow only schedules tasks within your working hours.
              </Text>
            </View>
            <View className="overflow-hidden rounded-2xl border border-border bg-card">
              <TimePickerRow
                label="Work starts at"
                value={workStart}
                onChange={setWorkStart}
              />
              <TimePickerRow
                label="Work ends at"
                value={workEnd}
                onChange={setWorkEnd}
                className="border-t border-border"
              />
            </View>
            <View
              className={cn(
                "flex-row items-center gap-3 rounded-2xl border p-3.5",
                validHours
                  ? "border-border bg-card"
                  : "border-destructive/35 bg-destructive/[0.09]",
              )}
            >
              <View
                className={cn(
                  "h-[38px] w-[38px] items-center justify-center rounded-[11px] border",
                  validHours
                    ? "border-border bg-muted"
                    : "border-destructive/35 bg-destructive/14",
                )}
              >
                <Clock
                  size={18}
                  className={
                    validHours ? "text-muted-foreground" : "text-destructive"
                  }
                />
              </View>
              <View className="flex-1">
                <Text
                  className={cn(
                    "text-[14px] font-semibold",
                    !validHours && "text-destructive",
                  )}
                >
                  {validHours
                    ? `${hours} hours of schedulable time`
                    : "Window must be at least an hour long"}
                </Text>
                <Text className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {minutesToLabel(workStart)} – {minutesToLabel(workEnd)}
                  {wraps ? " (next day)" : ""}
                </Text>
              </View>
            </View>
            {validHours ? (
              <View className="flex-row items-start gap-2">
                <Info
                  size={14}
                  className="mt-0.5 shrink-0 text-muted-foreground"
                />
                <Text className="flex-1 text-xs text-muted-foreground">
                  Timezone{" "}
                  <Text className="text-xs font-semibold text-foreground">
                    {timezone}
                  </Text>{" "}
                  — detected automatically.
                </Text>
              </View>
            ) : (
              <View className="flex-row items-start gap-2.5 rounded-2xl border border-destructive/35 bg-destructive/10 p-3.5">
                <AlertCircle
                  size={19}
                  className="mt-0.5 shrink-0 text-destructive"
                />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-destructive">
                    Working window too short
                  </Text>
                  <Text className="mt-0.5 text-[13px] leading-snug text-destructive/80">
                    Pick an end time at least an hour after the start so
                    Zenflow has room to schedule.
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {step === 2 && (
          <View className="gap-3.5 pt-1">
            <View>
              <Text className="text-[23px] font-bold tracking-tight">
                Which days?
              </Text>
              <Text className="mt-2 text-sm text-muted-foreground">
                Pick the days you want tasks scheduled on.
              </Text>
            </View>
            <WorkDaysGrid value={workDays} onToggle={toggleDay} />
            <Text className="mt-1 text-center text-[13px] text-muted-foreground">
              <Text className="font-semibold text-foreground">
                {workDays.length} {workDays.length === 1 ? "day" : "days"}
              </Text>{" "}
              selected ·{" "}
              {DAYS.filter((d) => workDays.includes(d.iso))
                .map((d) => d.label)
                .join(", ")}
            </Text>
          </View>
        )}

        {step === 3 && (
          <View className="gap-3.5 pt-1">
            <View>
              <Text className="text-[23px] font-bold tracking-tight">
                Duration adjustments
              </Text>
              <Text className="mt-2 text-sm text-muted-foreground">
                Zenflow learns how long your tasks really take. Pick how it
                applies what it learns — you can change this anytime.
              </Text>
            </View>
            <DurationModeField
              value={durationMode}
              onChange={setDurationMode}
            />
          </View>
        )}

        {step === 4 && (
          <View className="gap-3.5 pt-1">
            <View>
              <Text className="text-[23px] font-bold tracking-tight">
                You're all set
              </Text>
              <Text className="mt-2 text-sm text-muted-foreground">
                Review and start planning.
              </Text>
            </View>
            <View className="overflow-hidden rounded-2xl border border-border bg-card">
              <SummaryRow
                label="Hours"
                value={`${minutesToLabel(workStart)} – ${minutesToLabel(workEnd)}${wraps ? " (next day)" : ""}`}
                mono
              />
              <SummaryRow
                label="Days"
                value={DAYS.filter((d) => workDays.includes(d.iso))
                  .map((d) => d.label)
                  .join(", ")}
                className="border-t border-border"
              />
              <SummaryRow
                label="Adjustments"
                value={
                  DURATION_MODES.find((m) => m.id === durationMode)?.name ??
                  "Automatic"
                }
                className="border-t border-border"
              />
              <SummaryRow
                label="Timezone"
                value={timezone}
                className="border-t border-border"
              />
            </View>
            <View className="flex-row items-start gap-2">
              <Info
                size={14}
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              <Text className="flex-1 text-xs text-muted-foreground">
                You can change any of this later in Settings.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View className="flex-row items-center gap-3 rounded-t-3xl border-t border-border bg-background px-5 pb-7 pt-3.5 shadow-lg shadow-primary/25">
        {step === 0 ? (
          <Button className="w-full" onPress={() => setStep(1)}>
            <Text className="font-semibold text-primary-foreground">
              Get started
            </Text>
          </Button>
        ) : step < STEPS.length - 1 ? (
          <>
            <Button
              variant="outline"
              onPress={() => setStep((s) => Math.max(0, s - 1))}
            >
              <ChevronLeft size={14} className="text-foreground" />
              <Text className="ml-1">Back</Text>
            </Button>
            <Button
              className="flex-1"
              disabled={!canNext}
              onPress={() => setStep((s) => s + 1)}
            >
              <Text className="font-semibold text-primary-foreground">
                Continue
              </Text>
              <ChevronRight
                size={14}
                className="ml-1 text-primary-foreground"
              />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={loading}
              onPress={() => setStep((s) => Math.max(0, s - 1))}
            >
              <ChevronLeft size={14} className="text-foreground" />
              <Text className="ml-1">Back</Text>
            </Button>
            <Button
              className="flex-1 flex-row gap-2"
              disabled={loading}
              onPress={finish}
            >
              {loading && <ActivityIndicator size="small" color="black" />}
              <Text className="font-semibold text-primary-foreground">
                {loading ? "Finishing…" : "Start planning"}
              </Text>
            </Button>
          </>
        )}
      </View>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <View className={cn("flex-row items-center gap-3 px-4 py-3.5", className)}>
      <Text className="flex-1 text-[15px] font-semibold">{label}</Text>
      <Text
        className={cn(
          "text-sm font-semibold text-foreground",
          mono && "font-mono",
        )}
      >
        {value}
      </Text>
    </View>
  );
}
