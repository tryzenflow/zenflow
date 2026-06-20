import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clock,
  Globe,
  Info,
  LogOut,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/hooks/use-user-store";
import { updatePreferences } from "@/api/users";
import { logout } from "@/api/auth";
import {
  ARCHETYPES,
  DAYS,
  isValidWindow,
  minutesToLabel,
  TimeSelect,
  windowWraps,
  workWindowMinutes,
} from "@/components/settings/preferences-fields";
import { DurationModeField } from "@/components/settings/duration-mode-field";
import { PreferenceHeatmap } from "@/components/settings/preference-heatmap";
import type { DurationAdjustmentMode } from "@/types/phase2";

/** Detected IANA timezone, falling back to UTC. */
function detectedTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Full IANA zone list when the runtime supports it, else a small fallback. */
function timezoneOptions(current: string): string[] {
  const supported = Intl.supportedValuesOf?.("timeZone");
  const base =
    supported && supported.length > 0
      ? supported
      : [
          "UTC",
          "America/New_York",
          "America/Chicago",
          "America/Denver",
          "America/Los_Angeles",
          "Europe/London",
          "Europe/Berlin",
          "Europe/Paris",
          "Asia/Kolkata",
          "Asia/Singapore",
          "Asia/Ho_Chi_Minh",
          "Asia/Tokyo",
          "Australia/Sydney",
        ];
  // Make sure the user's current value is always selectable.
  return base.includes(current) ? base : [current, ...base];
}

/** Log the user out locally even if the network call fails, then route to login. */
async function performLogout(navigate: (to: string) => void) {
  try {
    await logout();
  } catch {
    // Sign the user out locally even if the request fails.
  } finally {
    useUserStore.getState().setUser(null);
    navigate("/login");
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabId = "work" | "scheduling" | "insights" | "account";

const TABS: { id: TabId; label: string; icon: typeof Clock }[] = [
  { id: "work", label: "Work", icon: CalendarDays },
  { id: "scheduling", label: "Scheduling", icon: SlidersHorizontal },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "account", label: "Account", icon: UserRound },
];

/**
 * Tabbed preferences dialog (Todoist-style): Work hours/days · Scheduling ·
 * Insights · Account. The Scheduling tab hosts the Phase-2
 * `auto|ask|never` duration-adjustment control; Insights hosts the 7×96
 * preference heatmap (mounted only when its tab is active → fetch-on-open).
 * Local state resets from the current user every time the dialog opens.
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const navigate = useNavigate();
  const { user, setUser } = useUserStore();

  const [tab, setTab] = useState<TabId>("work");
  const [workStart, setWorkStart] = useState(user?.workStart ?? 540);
  const [workEnd, setWorkEnd] = useState(user?.workEnd ?? 1020);
  const [workDays, setWorkDays] = useState<number[]>(
    user?.workDays ?? [1, 2, 3, 4, 5],
  );
  const [roleArchetypeId, setRole] = useState<string | null>(
    user?.roleArchetypeId ?? null,
  );
  const [timezone, setTimezone] = useState(
    user?.timezone ?? detectedTimezone(),
  );
  const [durationMode, setDurationMode] =
    useState<DurationAdjustmentMode>("auto");
  const [loading, setLoading] = useState(false);

  // Re-seed local state from the latest user whenever the dialog opens, so a
  // re-open always reflects the server's saved values.
  useEffect(() => {
    if (!open) return;
    setTab("work");
    setWorkStart(user?.workStart ?? 540);
    setWorkEnd(user?.workEnd ?? 1020);
    setWorkDays(user?.workDays ?? [1, 2, 3, 4, 5]);
    setRole(user?.roleArchetypeId ?? null);
    setTimezone(user?.timezone ?? detectedTimezone());
    setDurationMode(user?.durationAdjustmentMode ?? "auto");
  }, [open, user]);

  const zones = useMemo(() => timezoneOptions(timezone), [timezone]);
  const detected = useMemo(detectedTimezone, []);

  const hours = workWindowMinutes(workStart, workEnd) / 60;
  const validHours = isValidWindow(workStart, workEnd);
  const wraps = windowWraps(workStart, workEnd);
  const validDays = workDays.length > 0;
  const canSave = validHours && validDays && !loading;

  function toggleDay(iso: number) {
    setWorkDays((d) =>
      d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort(),
    );
  }

  async function save() {
    if (!canSave) return;
    setLoading(true);
    try {
      const updated = await updatePreferences({
        workStart,
        workEnd,
        workDays,
        timezone,
        roleArchetypeId,
        durationAdjustmentMode: durationMode,
      });
      setUser(updated);
      toast.success("Settings saved");
      onOpenChange(false);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Failed to save settings",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Tune the working rhythm and learning behaviour Zenflow uses to
            schedule your tasks.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          className="flex min-h-0 flex-1 mt-4 px-6 flex-col gap-0"
        >

            <TabsList className="w-full">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                  >
                    <Icon className="size-3.5" />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>


          <div className="min-h-0 flex-1 overflow-y-auto py-6">
            {/* Work hours / days / role / timezone */}
            <TabsContent value="work" className="mt-0 space-y-6">
              <Section
                title="Work hours"
                description="Zenflow only schedules tasks within your working hours."
              >
                <div className="space-y-4">
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
                </div>
              </Section>

              <Section
                title="Work days"
                description="Pick the days you want tasks scheduled on."
              >
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
                {!validDays && (
                  <p className="text-[11px] font-medium text-destructive">
                    Pick at least one work day.
                  </p>
                )}
              </Section>

              <Section
                title="Your role"
                description="Optional — helps Zenflow seed smarter defaults. Tap again to clear."
              >
                <div className="space-y-2">
                  {ARCHETYPES.map((a) => {
                    const on = roleArchetypeId === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setRole(on ? null : a.id)}
                        className={cn(
                          "w-full rounded-md border p-3 text-left transition-colors",
                          on
                            ? "border-primary bg-primary/10"
                            : "border-border bg-card hover:border-primary/50",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{a.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {a.sig}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {a.blurb}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section
                title="Timezone"
                description="All calendar times are shown in this timezone."
              >
                <div className="space-y-2">
                  <label className="text-xs font-semibold">Timezone</label>
                  <div className="relative">
                    <Globe className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="h-10 w-full appearance-none rounded-md border border-border bg-card pl-9 pr-9 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {zones.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                  {timezone !== detected && (
                    <button
                      type="button"
                      onClick={() => setTimezone(detected)}
                      className="flex items-start gap-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        Use detected timezone{" "}
                        <strong className="font-semibold text-foreground">
                          {detected}
                        </strong>
                      </span>
                    </button>
                  )}
                </div>
              </Section>
            </TabsContent>

            {/* Scheduling — duration-adjustment mode */}
            <TabsContent value="scheduling" className="mt-0 space-y-6">
              <Section
                title="Duration adjustments"
                description="Zenflow learns how long your tasks really take and can correct your estimates. Choose how it surfaces that."
              >
                <DurationModeField
                  value={durationMode}
                  onChange={setDurationMode}
                />
              </Section>
            </TabsContent>

            {/* Insights — preference heatmap (fetch-on-open) */}
            <TabsContent value="insights" className="mt-0 space-y-6">
              <Section
                title="Your preference map"
                description="When Zenflow tends to keep your work (amber) or move it away (slate), by day and time."
              >
                {tab === "insights" && <PreferenceHeatmap />}
              </Section>
            </TabsContent>

            {/* Account — sign out */}
            <TabsContent value="account" className="mt-0 space-y-6">
              <Section
                title="Account"
                description="You're signed in to Zenflow."
              >
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-muted/40 p-3.5">
                    <p className="text-sm font-semibold">{user?.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {user?.email}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => performLogout(navigate)}
                    disabled={loading}
                  >
                    <LogOut className="h-3.5 w-3.5" /> Log out
                  </Button>
                </div>
              </Section>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          {tab === "work" || tab === "scheduling" ? (
            <>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button onClick={save} disabled={!canSave}>
                {loading ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
