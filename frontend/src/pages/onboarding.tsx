import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { Check, ChevronLeft, ChevronRight, Clock, Info } from "lucide-react";
import { WithAuth } from "@/components/hoc/with-auth";
import { Wordmark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/hooks/use-user-store";
import { completeOnboarding } from "@/api/users";
import {
  DAYS,
  isValidWindow,
  minutesToLabel,
  TimeSelect,
  windowWraps,
  workWindowMinutes,
} from "@/components/settings/preferences-fields";

const STEPS = ["Welcome", "Work Hours", "Work Days", "All Set"];

function StepRail({ current }: { current: number }) {
  return (
    <div className="hidden w-72 shrink-0 flex-col border-r border-border bg-card px-8 py-10 md:flex">
      <div className="mb-12 flex items-center gap-2.5">
        <Wordmark />
      </div>
      <div className="space-y-1">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div
              key={label}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5",
                active && "bg-primary/10",
              )}
            >
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                  done && "border-primary bg-primary",
                  active && "border-primary bg-card",
                  !done && !active && "border-border",
                )}
              >
                {done ? (
                  <Check className="h-2.5 w-2.5 text-primary-foreground" />
                ) : active ? (
                  <div className="h-2 w-2 rounded-full bg-primary" />
                ) : (
                  <span className="text-[9px] font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium",
                  active
                    ? "font-semibold text-primary"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground">
        Setup takes under 60 seconds. Your schedule adapts to your preferences
        from day one.
      </p>
    </div>
  );
}

function OnboardingWizard() {
  const navigate = useNavigate();
  const { user, setUser } = useUserStore();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [workStart, setWorkStart] = useState(540);
  const [workEnd, setWorkEnd] = useState(1020);
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  // Already onboarded → straight to the app.
  useEffect(() => {
    if (user?.onboardingComplete) navigate("/");
  }, [user, navigate]);

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
    step === 0;

  async function finish() {
    setLoading(true);
    try {
      const updated = await completeOnboarding({
        workStart,
        workEnd,
        workDays,
        timezone,
      });
      setUser(updated);
      toast.success("You're all set 🎉");
      navigate("/");
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Failed to complete onboarding",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <StepRail current={step} />
      <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-muted/60 to-background p-4 sm:p-8">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card/80 p-6 backdrop-blur-xl sm:p-8">
          <div className="mb-8">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </div>

            {step === 0 && (
              <>
                <h1 className="mb-2 text-2xl font-bold tracking-tight">
                  Welcome to Zenflow
                </h1>
                <p className="text-sm text-muted-foreground">
                  A focus-first planner that schedules your work for you. Let's
                  set up your working rhythm — it takes under a minute.
                </p>
              </>
            )}
            {step === 1 && (
              <>
                <h1 className="mb-2 text-2xl font-bold tracking-tight">
                  When do you work?
                </h1>
                <p className="text-sm text-muted-foreground">
                  Zenflow only schedules tasks within your working hours.
                </p>
              </>
            )}
            {step === 2 && (
              <>
                <h1 className="mb-2 text-2xl font-bold tracking-tight">
                  Which days?
                </h1>
                <p className="text-sm text-muted-foreground">
                  Pick the days you want tasks scheduled on.
                </p>
              </>
            )}
            {step === 3 && (
              <>
                <h1 className="mb-2 text-2xl font-bold tracking-tight">
                  You're all set
                </h1>
                <p className="text-sm text-muted-foreground">
                  Review and start planning.
                </p>
              </>
            )}
          </div>

          <div className="space-y-6">
            {step === 1 && (
              <>
                <TimeSelect
                  label="Work starts at"
                  value={workStart}
                  onChange={setWorkStart}
                />
                <TimeSelect
                  label="Work ends at"
                  value={workEnd}
                  onChange={setWorkEnd}
                />
                <div className="flex items-center gap-3 rounded-md border border-border bg-muted p-3.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold">
                      {validHours
                        ? `${hours} hours of schedulable time`
                        : "Window must be at least an hour long"}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {minutesToLabel(workStart)} – {minutesToLabel(workEnd)}
                      {wraps && (
                        <span className="ml-1 font-sans text-primary">
                          (next day)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    Timezone{" "}
                    <strong className="font-semibold text-foreground">
                      {timezone}
                    </strong>{" "}
                    — detected automatically.
                  </span>
                </div>
              </>
            )}

            {step === 2 && (
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const on = workDays.includes(d.iso);
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      onClick={() => toggleDay(d.iso)}
                      className={cn(
                        "h-10 w-14 rounded-md border text-xs font-semibold transition-colors",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:border-primary/50",
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-2 rounded-md border border-border bg-muted p-4 text-sm">
                <Row
                  label="Hours"
                  value={`${minutesToLabel(workStart)} – ${minutesToLabel(workEnd)}${
                    wraps ? " (next day)" : ""
                  }`}
                />
                <Row
                  label="Days"
                  value={DAYS.filter((d) => workDays.includes(d.iso))
                    .map((d) => d.label)
                    .join(", ")}
                />
                <Row label="Timezone" value={timezone} />
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={step === 0 || loading}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border px-4 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> Back
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setStep((s) => s + 1)}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Continue <ChevronRight className="h-3 w-3" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={loading}
                  onClick={finish}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {loading ? "Finishing…" : "Start planning"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <WithAuth>
      <OnboardingWizard />
    </WithAuth>
  );
}
