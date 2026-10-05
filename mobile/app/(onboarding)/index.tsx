import { listIntegrations } from "@/api/integrations";
import { createTagsBulk, listTags } from "@/api/tags";
import { updateBasicInfo } from "@/api/users";
import {
  AlertCircle,
  Bell,
  Check,
  ChevronLeft,
  Clock,
  GraduationCap,
  Globe,
  MapPin,
  Search,
  Tag,
  User,
} from "@/components/Icons";
import { TagPicker } from "@/components/onboarding/tag-picker";
import { DluAccountsSection } from "@/components/settings/dlu-accounts-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useNotificationToggle } from "@/hooks/use-notification-toggle";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useUserStore } from "@/hooks/use-user-store";
import {
  FIRST_STEP,
  type OnboardingStep,
  canGoBack,
  filterTimezones,
  initialTagSelection,
  nextStep,
  prevStep,
  stepProgress,
  tagsForBulk,
  utcOffsetMinutes,
} from "@/lib/onboarding";
import {
  LANGUAGES,
  REMINDERS,
  allTimezones,
  deviceTimezone,
} from "@/lib/preferences";
import { DEVICE_TIMEZONE } from "@/lib/preferences-sync";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Placeholder English copy, centralized so #78 (localization) can swap it for
 * translation keys in one place.
 */
const COPY = {
  skip: "Skip",
  skipForNow: "Skip for now",
  continue: "Continue",
  back: "Back",
  language: {
    title: "Choose your language",
    body: "You can change this any time in Settings. Everything after this screen switches immediately.",
  },
  name: {
    title: "What should we call you?",
    body: "Shown in the app and in reminders. We guessed it from your email.",
    label: "Display name",
    hint: "Prefilled from your email — edit if you like",
  },
  dlu: {
    title: "Connect your DLU account",
    body: "Zenflow watches your timetable, exams and LMS for changes and new assignments. Your login is only used to check DLU on your behalf.",
    hint: "Opens the same sign-in sheet as Settings → Connect your DLU account. You can connect later.",
  },
  notifications: {
    title: "Stay ahead of deadlines",
    body: "Zenflow sends a push when a reminder is due or your schedule changes. We'll ask iOS / Android for permission next.",
    rowTitle: "Allow notifications",
    rowBody: "Reminders and schedule changes",
    bullets: [
      "Reminder before each study session",
      "Alert when the timetable or an exam changes",
      "New LMS assignments, scheduled for you",
    ],
    enable: "Turn on notifications",
    notNow: "Not now",
    blockedTitle: "Notifications are blocked",
    blockedBody:
      "Turn them on in system settings to get reminders. The preference is saved as off for now.",
    openSettings: "Open system settings",
  },
  timezone: {
    title: "Where are you?",
    body: "Used to place sessions and reminders at the right local time.",
    detected: "Detected from device",
    search: "Search all timezones",
    refine: "Showing the closest matches — refine your search to see more",
  },
  reminder: {
    title: "Default reminder",
    body: "How long before a session should we nudge you? Each task can override this.",
    hint: "Optional step · stored as your default reminder.",
  },
  tags: {
    title: "Pick your tags",
    body: "Tags group your tasks and sessions. We've suggested a few for students — tap to keep, add your own, rename them later.",
    footer: (n: number) =>
      `${n} selected · saved to your account, available in the task form’s Tags field.`,
  },
  done: {
    title: "You’re all set",
    body: "Skipped steps are waiting for you in Settings.",
    open: "Open my calendar",
  },
  saveFailed: "Couldn't save. Try again.",
} as const;

/** Max timezones listed at once; more matches prompt a "refine" hint. */
const TZ_LIMIT = 50;

const LANGUAGE_SUB: Record<string, string> = {
  vi: "Vietnamese · default",
  en: "English",
};

const STEP_ICON: Partial<Record<OnboardingStep, typeof Globe>> = {
  language: Globe,
  name: User,
  dlu: GraduationCap,
  notifications: Bell,
  timezone: MapPin,
  reminder: Clock,
  tags: Tag,
};

/** "GMT+7", "GMT+5:30", "GMT" — derived from the offset, not Intl's shortOffset. */
function gmtOffset(tz: string): string {
  const min = utcOffsetMinutes(tz);
  if (min === 0) return "GMT";
  const abs = Math.abs(min);
  const mm = abs % 60;
  return `GMT${min < 0 ? "-" : "+"}${Math.floor(abs / 60)}${
    mm ? `:${String(mm).padStart(2, "0")}` : ""
  }`;
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <View
      className={cn(
        "size-[22px] shrink-0 items-center justify-center rounded-full border-2",
        selected ? "border-primary bg-primary" : "border-border",
      )}
    >
      {selected && <Check size={14} className="text-primary-foreground" />}
    </View>
  );
}

/** Rounded card whose children are separated by hairlines. */
function Group({ children }: { children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).flat();
  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-card">
      {items.filter(Boolean).map((child, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: static ordering
          key={i}
          className={cn(i > 0 && "border-t border-border")}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

function Row({
  selected,
  onPress,
  children,
  className,
}: {
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3.5",
        selected && "bg-primary/10",
        className,
      )}
    >
      {children}
    </Pressable>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const user = useUserStore((s) => s.user);
  const updateUser = useUserStore((s) => s.updateUser);
  const { setIntegrations, setLoading, integrations } = useIntegrationStore();
  const notif = useNotificationToggle();
  const { prefs, update } = notif;

  // Local UI step index only; every value below is persisted server-side.
  const [step, setStep] = useState<OnboardingStep>(FIRST_STEP);
  // Set when a skipped step is reopened from the done summary: finishing,
  // skipping or going back returns straight to the summary.
  const [fromSummary, setFromSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [blocked, setBlocked] = useState(false);
  const [tzQuery, setTzQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const [savedTagCount, setSavedTagCount] = useState(0);

  useEffect(() => {
    listIntegrations()
      .then(setIntegrations)
      .catch(() => {})
      .finally(() => setLoading(false));
    listTags()
      .then((existing) =>
        setTags(initialTagSelection(existing.map((t) => t.name))),
      )
      .catch(() => setTags(initialTagSelection([])))
      .finally(() => setTagsLoaded(true));
  }, [setIntegrations, setLoading]);

  // Returning from system settings with permission granted clears the hint.
  useEffect(() => {
    if (notif.permissionGranted) setBlocked(false);
  }, [notif.permissionGranted]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void usePushStatusStore.getState().refresh();
    });
    return () => sub.remove();
  }, []);

  const go = () => {
    if (fromSummary) {
      setFromSummary(false);
      setStep("done");
    } else {
      setStep((s) => nextStep(s));
    }
  };
  const goBack = () => {
    setBlocked(false);
    if (fromSummary) {
      setFromSummary(false);
      setStep("done");
    } else {
      setStep((s) => prevStep(s));
    }
  };
  const dluConnected = integrations.some((i) => i.connected);
  const device = deviceTimezone();
  const zones = useMemo(
    () => filterTimezones(allTimezones(), tzQuery, TZ_LIMIT, device),
    [tzQuery, device],
  );

  async function run(fn: () => Promise<undefined | false>) {
    setBusy(true);
    try {
      if ((await fn()) !== false) go();
    } catch {
      toast(COPY.saveFailed, "destructive");
    } finally {
      setBusy(false);
    }
  }

  // Preference saves started by tapping a choice; Continue/Skip/finish wait
  // for them so onboarding can't move on (or complete) with a save pending
  // that might still fail and roll the choice back.
  const pendingSaves = useRef(new Set<Promise<boolean>>());

  function savePref(patch: Parameters<typeof update>[0]) {
    const p = (async () => {
      if (await update(patch)) return true;
      toast(COPY.saveFailed, "destructive");
      return false;
    })();
    pendingSaves.current.add(p);
    void p.finally(() => pendingSaves.current.delete(p));
    return p;
  }

  /** Wait for in-flight saves; false if any failed (toast already shown). */
  async function settleSaves() {
    const results = await Promise.all([...pendingSaves.current]);
    return results.every(Boolean);
  }

  /** Advance once pending saves finish; stay on the step if one failed. */
  const advance = () =>
    run(async () => ((await settleSaves()) ? undefined : false));

  const saveName = () =>
    run(async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === user?.name) return;
      updateUser(await updateBasicInfo({ name: trimmed }));
    });

  const saveTags = () =>
    run(async () => {
      const names = tagsForBulk(tags);
      if (names.length > 0) await createTagsBulk(names);
      setSavedTagCount(names.length);
    });

  /**
   * Turn notifications on. "saved" = the preference is on but this device
   * couldn't register (simulator / no FCM) — a quiet success, retried next
   * launch. A failed preference save is NOT that: it stays on the step.
   */
  async function turnOnNotifications(): Promise<"on" | "saved" | "blocked" | "failed"> {
    if (await notif.setEnabled(true, { quiet: true })) return "on";
    const granted = usePushStatusStore.getState().permission === "granted";
    if (!granted) return "blocked";
    if (useUserStore.getState().user?.allowNotifications === true) {
      return "saved";
    }
    toast(COPY.saveFailed, "destructive");
    return "failed";
  }

  async function enableNotifications() {
    setBusy(true);
    const result = await turnOnNotifications();
    setBusy(false);
    if (result === "on" || result === "saved") go();
    else setBlocked(result === "blocked");
  }

  async function toggleNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      if (notif.active) {
        await notif.setEnabled(false);
        return;
      }
      setBlocked((await turnOnNotifications()) === "blocked");
    } finally {
      setBusy(false);
    }
  }

  async function notNow() {
    await notif.setEnabled(false);
    go();
  }

  async function finish() {
    setBusy(true);
    try {
      if (!(await settleSaves())) {
        setBusy(false);
        return;
      }
      // Idempotent; the root AuthGate then routes to the app.
      updateUser(await updateBasicInfo({ onboarded: true }));
    } catch {
      toast(COPY.saveFailed, "destructive");
      setBusy(false);
    }
  }

  const progress = stepProgress(step);
  const primary = (label: string, onPress: () => void, disabled = false) => (
    <Button
      size="lg"
      className="rounded-xl"
      disabled={busy || disabled}
      onPress={onPress}
    >
      <Text className="font-semibold text-primary-foreground">{label}</Text>
    </Button>
  );
  const ghost = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} disabled={busy} className="items-center py-3">
      <Text className="text-[14px] font-medium text-muted-foreground">
        {label}
      </Text>
    </Pressable>
  );

  let title = "";
  let body = "";
  let content: React.ReactNode = null;
  let footer: React.ReactNode = null;

  switch (step) {
    case "language":
      ({ title, body } = COPY.language);
      content = (
        <Group>
          {[...LANGUAGES]
            .sort((x, y) => (x.value === "vi" ? -1 : y.value === "vi" ? 1 : 0))
            .map((l) => (
              <Row
                key={l.value}
                selected={prefs.language === l.value}
                onPress={() => void savePref({ language: l.value })}
              >
                <Text className="text-[26px] leading-[32px]">
                  {l.flag}
                </Text>
                <View className="flex-1">
                  <Text className="text-[16px] font-semibold">{l.label}</Text>
                  <Text className="text-[13px] text-muted-foreground">
                    {LANGUAGE_SUB[l.value]}
                  </Text>
                </View>
                <RadioDot selected={prefs.language === l.value} />
              </Row>
            ))}
        </Group>
      );
      footer = primary(COPY.continue, advance);
      break;
    case "name":
      ({ title, body } = COPY.name);
      content = (
        <View>
          <Text className="mb-2 text-[13.5px] font-semibold">
            {COPY.name.label}
          </Text>
          <Input
            value={name}
            onChangeText={setName}
            autoComplete="name"
            maxLength={100}
          />
          <Text className="mt-2 text-[12.5px] text-muted-foreground">
            {COPY.name.hint}
          </Text>
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, saveName, !name.trim())}
          {ghost(COPY.skipForNow, advance)}
        </>
      );
      break;
    case "dlu":
      ({ title, body } = COPY.dlu);
      content = (
        <View>
          <DluAccountsSection hideLabel />
          <Text className="mt-3.5 px-1 text-[12px] leading-snug text-muted-foreground">
            {COPY.dlu.hint}
          </Text>
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, advance)}
          {!dluConnected && ghost(COPY.skipForNow, advance)}
        </>
      );
      break;
    case "notifications":
      ({ title, body } = COPY.notifications);
      content = (
        <View>
          <Group>
            <View className="flex-row items-center gap-[13px] px-4 py-3.5">
              <View className="size-[38px] items-center justify-center rounded-xl bg-muted">
                <Bell size={18} className="text-foreground" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold">
                  {COPY.notifications.rowTitle}
                </Text>
                <Text className="mt-0.5 text-[13px] text-muted-foreground">
                  {COPY.notifications.rowBody}
                </Text>
              </View>
              <Pressable
                onPress={() => void toggleNotifications()}
                disabled={busy}
                hitSlop={8}
                role="switch"
                aria-checked={notif.active}
                accessibilityLabel={COPY.notifications.rowTitle}
                className={cn(
                  "h-[26px] w-[46px] justify-center rounded-full px-[3px]",
                  notif.active ? "items-end bg-primary" : "items-start bg-muted",
                )}
              >
                <View
                  className={cn(
                    "size-5 rounded-full shadow",
                    notif.active ? "bg-white" : "bg-card",
                  )}
                />
              </Pressable>
            </View>
          </Group>
          <View className="mt-4 gap-3 px-1">
            {COPY.notifications.bullets.map((b) => (
              <View key={b} className="flex-row items-start gap-2.5">
                <Check size={16} className="mt-0.5 text-primary" />
                <Text className="flex-1 text-[13.5px] text-muted-foreground">
                  {b}
                </Text>
              </View>
            ))}
          </View>
          {blocked && (
            <View className="mt-5 flex-row gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
              <AlertCircle size={20} className="text-destructive" />
              <View className="flex-1">
                <Text className="text-[13.5px] font-semibold">
                  {COPY.notifications.blockedTitle}
                </Text>
                <Text className="mt-1 text-[13.5px] leading-snug text-muted-foreground">
                  {COPY.notifications.blockedBody}
                </Text>
                <Pressable
                  onPress={() => void Linking.openSettings()}
                  className="mt-2"
                >
                  <Text className="text-[13.5px] font-semibold text-primary">
                    {COPY.notifications.openSettings}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      );
      footer = (
        <>
          {primary(
            notif.active
              ? COPY.continue
              : blocked
                ? COPY.notifications.openSettings
                : COPY.notifications.enable,
            notif.active
              ? advance
              : blocked
                ? () => void Linking.openSettings()
                : enableNotifications,
          )}
          {!notif.active &&
            ghost(COPY.notifications.notNow, blocked ? advance : notNow)}
        </>
      );
      break;
    case "timezone":
      ({ title, body } = COPY.timezone);
      content = (
        <View>
          <Pressable
            onPress={() => void savePref({ timezone: DEVICE_TIMEZONE })}
            accessibilityRole="radio"
            accessibilityState={{ checked: prefs.timezoneMode === "device" }}
            className={cn(
              "flex-row items-center gap-3 rounded-2xl border px-4 py-3.5",
              prefs.timezoneMode === "device"
                ? "border-primary/50 bg-primary/10"
                : "border-border bg-card",
            )}
          >
            <MapPin size={20} className="text-primary" />
            <View className="flex-1">
              <Text className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
                {COPY.timezone.detected}
              </Text>
              <Text className="text-[15px] font-semibold">
                {device}
                <Text className="font-normal text-muted-foreground">
                  {gmtOffset(device) ? ` · ${gmtOffset(device)}` : ""}
                </Text>
              </Text>
            </View>
            <RadioDot selected={prefs.timezoneMode === "device"} />
          </Pressable>
          <View className="mt-4">
            <Input
              value={tzQuery}
              onChangeText={setTzQuery}
              placeholder={COPY.timezone.search}
              autoCapitalize="none"
              autoCorrect={false}
              rightElement={<Search size={18} className="text-muted-foreground" />}
            />
          </View>
          <View className="mt-3">
            <Group>
              {zones.map((z) => {
                const on =
                  prefs.timezoneMode === "explicit" && prefs.timezone === z;
                return (
                  <Row
                    key={z}
                    selected={on}
                    onPress={() => void savePref({ timezone: z })}
                    className="justify-between"
                  >
                    <Text
                      className={cn(
                        "flex-1 text-[15px]",
                        on ? "font-semibold" : "font-medium",
                      )}
                    >
                      {z}
                    </Text>
                    <Text className="text-[13px] text-muted-foreground">
                      {gmtOffset(z)}
                    </Text>
                    {on && <RadioDot selected />}
                  </Row>
                );
              })}
            </Group>
            {zones.length >= TZ_LIMIT && (
              <Text className="mt-3 px-1 text-center text-[12.5px] text-muted-foreground">
                {COPY.timezone.refine}
              </Text>
            )}
          </View>
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, advance)}
          {ghost(COPY.skipForNow, advance)}
        </>
      );
      break;
    case "reminder":
      ({ title, body } = COPY.reminder);
      content = (
        <View>
          <Group>
            {REMINDERS.map((r) => {
              const on = prefs.defaultReminder === r.value;
              return (
                <Row
                  key={r.value}
                  selected={on}
                  onPress={() => void savePref({ defaultReminder: r.value })}
                  className="justify-between"
                >
                  <Text
                    className={cn(
                      "flex-1 text-[15px]",
                      on ? "font-semibold" : "font-medium",
                    )}
                  >
                    {r.label}
                  </Text>
                  <RadioDot selected={on} />
                </Row>
              );
            })}
          </Group>
          <Text className="mt-3 px-1 text-[12px] text-muted-foreground">
            {COPY.reminder.hint}
          </Text>
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, advance)}
          {ghost(COPY.skipForNow, advance)}
        </>
      );
      break;
    case "tags":
      ({ title, body } = COPY.tags);
      content = tagsLoaded ? (
        <View>
          <TagPicker selected={tags} onChange={setTags} />
          <Text className="mt-3 px-1 text-[12.5px] text-muted-foreground">
            {COPY.tags.footer(tagsForBulk(tags).length)}
          </Text>
        </View>
      ) : null;
      footer = (
        <>
          {primary(
            tagsForBulk(tags).length > 0
              ? `${COPY.continue} · ${tagsForBulk(tags).length} tags`
              : COPY.continue,
            saveTags,
            !tagsLoaded,
          )}
          {tagsForBulk(tags).length === 0 && ghost(COPY.skipForNow, advance)}
        </>
      );
      break;
    case "done": {
      ({ title, body } = COPY.done);
      const rows: {
        k: string;
        v: string;
        skipped?: boolean;
        step?: OnboardingStep;
      }[] = [
        {
          k: "Language",
          v: LANGUAGES.find((l) => l.value === prefs.language)?.label ?? "",
        },
        { k: "Name", v: user?.name ?? "" },
        {
          k: "DLU account",
          v: dluConnected ? "Connected" : "Skipped",
          skipped: !dluConnected,
          step: "dlu",
        },
        {
          k: "Notifications",
          v: notif.active ? "On" : "Skipped",
          skipped: !notif.active,
          step: "notifications",
        },
        { k: "Timezone", v: prefs.timezone },
        {
          k: "Default reminder",
          v:
            REMINDERS.find((r) => r.value === prefs.defaultReminder)?.label ??
            "",
        },
        { k: "Tags", v: `${savedTagCount} selected` },
      ];
      content = (
        <Group>
          {rows.map((r) => (
            <View
              key={r.k}
              className="flex-row items-center justify-between px-4 py-3"
            >
              <Text className="text-[14.5px] font-medium">{r.k}</Text>
              <View className="flex-row items-center gap-2.5">
                <Text className="text-[13px] text-muted-foreground">{r.v}</Text>
                {r.skipped && r.step ? (
                  <Pressable
                    onPress={() => {
                      setFromSummary(true);
                      setStep(r.step as OnboardingStep);
                    }}
                  >
                    <Text className="text-[13px] font-semibold text-primary">
                      Set up
                    </Text>
                  </Pressable>
                ) : (
                  <Check size={16} className="text-emerald-500" />
                )}
              </View>
            </View>
          ))}
        </Group>
      );
      footer = primary(COPY.done.open, finish);
      break;
    }
  }

  const Hero = STEP_ICON[step];

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {step !== "done" ? (
        <View
          className="flex-row items-center gap-3 px-3 pb-3"
          style={{ paddingTop: insets.top + 6 }}
        >
          {canGoBack(step) ? (
            <Pressable
              onPress={goBack}
              hitSlop={8}
              accessibilityLabel={COPY.back}
              className="size-[38px] items-center justify-center rounded-xl"
            >
              <ChevronLeft size={22} className="text-foreground" />
            </Pressable>
          ) : (
            <View className="size-[38px]" />
          )}
          <View className="flex-1 flex-row gap-1.5">
            {Array.from({ length: progress.total }, (_, i) => (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length bar
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i < progress.index ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </View>
          <Pressable
            onPress={() => {
              setBlocked(false);
              void advance();
            }}
            hitSlop={8}
            disabled={busy}
            className="px-2"
          >
            <Text className="text-[14px] font-semibold text-muted-foreground">
              {COPY.skip}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ paddingTop: insets.top + 10 }} />
      )}
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <View className={cn("px-6 pt-3", step === "done" && "items-center pt-8")}>
          {step === "done" ? (
            <View className="mb-5 size-16 items-center justify-center rounded-full bg-brand-orange">
              <Check size={30} className="text-primary-foreground" />
            </View>
          ) : Hero ? (
            <View className="mb-4 size-12 items-center justify-center rounded-2xl bg-primary/10">
              <Hero size={24} className="text-primary" />
            </View>
          ) : null}
          <Text
            className={cn(
              "text-[26px] font-bold leading-tight tracking-tight",
              step === "done" && "text-center",
            )}
          >
            {title}
          </Text>
          <Text
            className={cn(
              "mt-2 text-[14.5px] leading-relaxed text-muted-foreground",
              step === "done" && "text-center",
            )}
          >
            {body}
          </Text>
        </View>
        <View className={cn("px-5", step === "language" ? "mt-6" : "mt-6")}>
          {content}
        </View>
      </ScrollView>
      <View
        className="gap-1 px-5 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        {footer}
      </View>
    </KeyboardAvoidingView>
  );
}
