import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { listIntegrations } from "@/api/integrations";
import { createTagsBulk, listTags } from "@/api/tags";
import { createSession, searchSessions } from "@/api/tasks";
import { updateBasicInfo } from "@/api/users";
import {
  AlertCircle,
  Bell,
  Check,
  ChevronLeft,
  GraduationCap,
  Sliders,
  Sun,
  User,
} from "@/components/Icons";
import { ImportedTimetable } from "@/components/onboarding/imported-timetable";
import { DluAccountsSection } from "@/components/settings/dlu-accounts-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useNotificationToggle } from "@/hooks/use-notification-toggle";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useUserStore } from "@/hooks/use-user-store";
import { DEFAULT_USER_NAME, type FocusBand } from "@zenflow/shared";
import { focusBandOptions } from "@/lib/focus-band";
import {
  FIRST_STEP,
  type OnboardingStep,
  canGoBack,
  dndRoutinePayloads,
  initialTagSelection,
  missingRoutines,
  newTagsForBulk,
  nextStep,
  prevStep,
  stepProgress,
} from "@/lib/onboarding";
import { LANGUAGES } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
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
  get skip() {
    return t("Skip");
  },
  get skipForNow() {
    return t("Skip for now");
  },
  get continue() {
    return t("Continue");
  },
  get back() {
    return t("Back");
  },
  name: {
    get title() {
      return t("What should we call you?");
    },
    get body() {
      return t(
        "Shown in the app and in your reminders.",
      );
    },
    get label() {
      return t("Display name");
    },
  },
  focus: {
    get title() {
      return t("When do you focus best?");
    },
    get body() {
      return t("We'll try this part of the day first when we place your sessions.");
    },
  },
  dlu: {
    get title() {
      return t("Connect your LMS or portal");
    },
    get body() {
      return t(
        "Zenflow keeps an eye on your timetable, exams and assignments, so they land on your calendar. Your login is only used to check your LMS and portal for you.",
      );
    },
    get hint() {
      return t(
        "You can also do this later in Settings, under Connect your LMS or portal.",
      );
    },
    get trust() {
      return t(
        "Your password is stored encrypted. Disconnect in Settings to delete it.",
      );
    },
  },
  notifications: {
    get title() {
      return t("Stay ahead of deadlines");
    },
    get body() {
      return t(
        "Get a nudge when a session is near or your schedule changes. We'll ask for permission next.",
      );
    },
    get rowTitle() {
      return t("Allow notifications");
    },
    get rowBody() {
      return t("Reminders and schedule changes");
    },
    bullets: [
      "Reminder before each study session",
      "Alert when the timetable or an exam changes",
      "New LMS assignments, scheduled for you",
    ],
    get enable() {
      return t("Turn on notifications");
    },
    get notNow() {
      return t("Not now");
    },
    get blockedTitle() {
      return t("Notifications are blocked");
    },
    get blockedBody() {
      return t(
        "Turn them on in system settings to get reminders. For now, they stay off.",
      );
    },
    get openSettings() {
      return t("Open system settings");
    },
  },
  done: {
    get title() {
      return t("You’re all set");
    },
    get body() {
      return t("Skipped steps are waiting for you in Settings.");
    },
    get open() {
      return t("Open my calendar");
    },
  },
  get saveFailed() {
    return {
      title: t("Couldn't save"),
      description: t("Try again in a moment."),
      variant: "destructive",
      icon: Sliders,
    } as const;
  },
} as const;

const STEP_ICON: Partial<Record<OnboardingStep, typeof User>> = {
  name: User,
  focus: Sun,
  dlu: GraduationCap,
  notifications: Bell,
};

/** Rounded card whose children are separated by hairlines. */
function Group({ children }: { children: React.ReactNode }) {
  useLanguage();
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

export default function OnboardingScreen() {
  useLanguage();
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
  // The placeholder name means "not set": start empty instead of showing it.
  const [name, setName] = useState(
    user?.name && user.name !== DEFAULT_USER_NAME ? user.name : "",
  );
  const [blocked, setBlocked] = useState(false);
  const [focusBand, setFocusBand] = useState<FocusBand | null>(
    user?.focusBand ?? null,
  );

  useEffect(() => {
    listIntegrations()
      .then(setIntegrations)
      .catch(() => {})
      .finally(() => setLoading(false));
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

  async function run(fn: () => Promise<undefined | false>) {
    setBusy(true);
    try {
      if ((await fn()) !== false) go();
    } catch {
      toast(COPY.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  const advance = () => go();

  const saveName = () =>
    run(async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === user?.name) return;
      updateUser(await updateBasicInfo({ name: trimmed }));
    });

  const saveFocus = () =>
    run(async () => {
      if (!focusBand || focusBand === user?.focusBand) return;
      updateUser(await updateBasicInfo({ focusBand }));
    });

  /**
   * Turn notifications on. "saved" = the preference is on but this device
   * couldn't register (simulator / no FCM) — a quiet success, retried next
   * launch. A failed preference save is NOT that: it stays on the step.
   */
  async function turnOnNotifications(): Promise<
    "on" | "saved" | "blocked" | "failed"
  > {
    if (await notif.setEnabled(true, { quiet: true })) return "on";
    const granted = usePushStatusStore.getState().permission === "granted";
    if (!granted) return "blocked";
    if (useUserStore.getState().user?.allowNotifications === true) {
      return "saved";
    }
    toast(COPY.saveFailed);
    return "failed";
  }

  // A ref, not `busy`: taps queued behind a busy JS thread all see the same
  // stale `busy === false` closure and would each start a request.
  const notifPending = useRef(false);

  async function enableNotifications() {
    if (notifPending.current) return;
    notifPending.current = true;
    setBusy(true);
    try {
      const result = await turnOnNotifications();
      setBusy(false);
      if (result === "on" || result === "saved") go();
      else setBlocked(result === "blocked");
    } finally {
      notifPending.current = false;
      setBusy(false);
    }
  }

  async function toggleNotifications() {
    if (notifPending.current) return;
    notifPending.current = true;
    setBusy(true);
    try {
      if (notif.active) {
        await notif.setEnabled(false);
        return;
      }
      setBlocked((await turnOnNotifications()) === "blocked");
    } finally {
      notifPending.current = false;
      setBusy(false);
    }
  }

  async function notNow() {
    await notif.setEnabled(false);
    go();
  }

  /** Best effort: the four suggested tags; never blocks onboarding. */
  async function seedDefaultTags() {
    try {
      const existing = (await listTags()).map((tag) => tag.name);
      const names = newTagsForBulk(initialTagSelection(existing), existing);
      if (names.length > 0) await createTagsBulk(names);
    } catch {
      // Not worth blocking the first run on.
    }
  }

  /**
   * Best effort: the daily Sleep, Lunch break and Dinner DND series in the
   * user's timezone. Series already present by title are skipped. A failed
   * lookup creates nothing, so a retry can't duplicate them.
   */
  async function seedDefaultRoutines() {
    try {
      const now = new Date();
      const payloads = dndRoutinePayloads(user?.timezone || "UTC", now);
      const found = await Promise.all(
        payloads.map((p) =>
          searchSessions({ q: p.title, anchor: now.toISOString(), limit: 50 }),
        ),
      );
      const existing = found.flatMap((r) => r.sessions);
      for (const payload of missingRoutines(payloads, existing)) {
        await createSession(payload).catch(() => {});
      }
    } catch {
      // Not worth blocking the first run on.
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await seedDefaultTags();
      await seedDefaultRoutines();
      // Idempotent; the root AuthGate then routes to the app.
      updateUser(await updateBasicInfo({ onboarded: true }));
    } catch {
      toast(COPY.saveFailed);
      setBusy(false);
    }
  }

  const progress = stepProgress(step);
  const primary = (label: string, onPress: () => void, disabled = false) => (
    <Button
      size="lg"
      className="rounded-xl"
      testID="onboarding.primary"
      disabled={busy || disabled}
      onPress={onPress}
    >
      {busy ? (
        <Spinner testID="onboarding.busy" tone="onPrimary" />
      ) : (
        <Text className="font-semibold text-primary-foreground">{label}</Text>
      )}
    </Button>
  );
  const ghost = (label: string, onPress: () => void) => (
    <Pressable
      testID="onboarding.secondary"
      onPress={onPress}
      disabled={busy}
      className="items-center py-3"
    >
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
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, saveName, !name.trim())}
          {ghost(COPY.skipForNow, advance)}
        </>
      );
      break;
    case "focus":
      ({ title, body } = COPY.focus);
      content = (
        <Group>
          {focusBandOptions().map((option) => {
            const on = focusBand === option.band;
            return (
              <Pressable
                key={option.band}
                testID={`onboarding.focus.${option.band}`}
                onPress={() => setFocusBand(option.band)}
                disabled={busy}
                role="radio"
                aria-checked={on}
                className="flex-row items-center gap-3 px-4 py-3.5"
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className={cn(
                      "text-[15px]",
                      on ? "font-semibold" : "font-medium",
                    )}
                  >
                    {option.label}
                  </Text>
                  <Text className="mt-0.5 text-[13px] text-muted-foreground">
                    {option.hours}
                  </Text>
                </View>
                {on && <Check size={18} className="text-primary" />}
              </Pressable>
            );
          })}
        </Group>
      );
      footer = (
        <>
          {primary(COPY.continue, saveFocus, !focusBand)}
          {ghost(COPY.skipForNow, advance)}
        </>
      );
      break;
    case "dlu":
      ({ title, body } = COPY.dlu);
      content = (
        <View>
          <DluAccountsSection hideLabel />
          {dluConnected && <ImportedTimetable />}
          <Text className="mt-3.5 px-1 text-[12px] leading-snug text-muted-foreground">
            {COPY.dlu.trust}
          </Text>
          <Text className="mt-1.5 px-1 text-[12px] leading-snug text-muted-foreground">
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
                testID="onboarding.notifications-switch"
                className={cn(
                  "h-[26px] w-[46px] justify-center rounded-full px-[3px]",
                  busy && "opacity-60",
                  notif.active
                    ? "items-end bg-primary"
                    : "items-start bg-muted",
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
              <View key={t(b)} className="flex-row items-start gap-2.5">
                <Check size={16} className="mt-0.5 text-primary" />
                <Text className="flex-1 text-[13.5px] text-muted-foreground">
                  {t(b)}
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
    case "done": {
      ({ title, body } = COPY.done);
      const rows: {
        k: string;
        v: string;
        skipped?: boolean;
        step?: OnboardingStep;
      }[] = [
        {
          k: t("Language"),
          v: LANGUAGES.find((l) => l.value === prefs.language)?.label ?? "",
        },
        { k: t("Name"), v: user?.name ?? "" },
        {
          k: t("LMS & portal"),
          v: dluConnected ? t("Connected") : t("Skipped"),
          skipped: !dluConnected,
          step: "dlu",
        },
        {
          k: t("Notifications"),
          v: notif.active ? t("On") : t("Skipped"),
          skipped: !notif.active,
          step: "notifications",
        },
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
                      {t("Set up")}
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
        <View
          className={cn("px-6 pt-3", step === "done" && "items-center pt-8")}
        >
          {step === "done" ? (
            <View className="mb-5 size-16 items-center justify-center rounded-full bg-primary">
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
        <View className="px-5 mt-6">
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
