import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
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
  MapPin,
  Search,
  Tag,
  User,
} from "@/components/Icons";
import { TagPicker } from "@/components/onboarding/tag-picker";
import {
  DluAccountsSection,
  type DluAccountsHandle,
} from "@/components/settings/dlu-accounts-section";
import { Switch } from "@/components/ui/switch";
import { TextLink } from "@/components/ui/text-link";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useNotificationToggle } from "@/hooks/use-notification-toggle";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useUserStore } from "@/hooks/use-user-store";
import {
  DEFAULT_TIMEZONE,
  FIRST_STEP,
  type OnboardingStep,
  canGoBack,
  filterTimezones,
  gmtOffset,
  initialTagSelection,
  nextStep,
  onboardingStepKey,
  parseStoredStep,
  prevStep,
  stepProgress,
  suggestedTimezone,
  tagsForBulk,
  utcOffsetMinutes,
} from "@/lib/onboarding";
import {
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
        "Shown in the app and in reminders. We guessed it from your email.",
      );
    },
    get label() {
      return t("Display name");
    },
    get hint() {
      return t("Prefilled from your email — edit if you like");
    },
  },
  dlu: {
    get title() {
      return t("Connect your DLU account");
    },
    get body() {
      return t(
        "Zenflow keeps an eye on your timetable, exams and LMS, so new assignments land on your calendar. Your login is only used to check DLU for you.",
      );
    },
    get hint() {
      return t(
        "You can also do this later in Settings → Connect your DLU account.",
      );
    },
    get connect() {
      return t("Connect");
    },
    get later() {
      return t("Do it later");
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
  timezone: {
    get title() {
      return t("Where are you?");
    },
    get body() {
      return t("Used to place sessions and reminders at the right local time.");
    },
    get detected() {
      return t("Your timezone");
    },
    get change() {
      return t("Change");
    },
    get useDevice() {
      return t("Use my device's timezone");
    },
    get search() {
      return t("Search all timezones");
    },
    get refine() {
      return t("Showing the closest matches — refine your search to see more");
    },
  },
  reminder: {
    get title() {
      return t("Default reminder");
    },
    get body() {
      return t(
        "How early should we remind you? You can change it per task.",
      );
    },
    get hint() {
      return t("Optional · saved as your default reminder.");
    },
  },
  tags: {
    get title() {
      return t("Pick your tags");
    },
    get body() {
      return t(
        "Tags keep your tasks organised. Tap the ones you like, add your own, and rename them later.",
      );
    },
    footer: (n: number) =>
      t(
        "{count} selected · saved to your account",
        { count: n },
      ),
  },
  done: {
    get title() {
      return t("You’re all set");
    },
    get body() {
      return t("Anything not set up yet is waiting for you in Settings.");
    },
    get open() {
      return t("Open my calendar");
    },
  },
  get saveFailed() {
    return t("Couldn't save. Try again.");
  },
} as const;

/** Max timezones listed at once; more matches prompt a "refine" hint. */
const TZ_LIMIT = 50;

const STEP_ICON: Partial<Record<OnboardingStep, typeof User>> = {
  name: User,
  dlu: GraduationCap,
  notifications: Bell,
  timezone: MapPin,
  reminder: Clock,
  tags: Tag,
};

function RadioDot({ selected }: { selected: boolean }) {
  useLanguage();
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
  useLanguage();
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
  // The step is also kept on this device, so an interruption (a call, the app
  // killed) resumes where the student left off instead of at the start.
  const [resumed, setResumed] = useState(false);
  const dluRef = useRef<DluAccountsHandle>(null);
  const [tzChoice, setTzChoice] = useState<string | null>(null);
  const [tzPickerOpen, setTzPickerOpen] = useState(false);
  const [existingTagCount, setExistingTagCount] = useState(0);
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

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(onboardingStepKey(userId))
      .then((raw) => setStep(parseStoredStep(raw)))
      .catch(() => {})
      .finally(() => setResumed(true));
  }, [userId]);
  useEffect(() => {
    if (!resumed || !userId) return;
    AsyncStorage.setItem(onboardingStepKey(userId), step).catch(() => {});
  }, [step, resumed, userId]);

  useEffect(() => {
    listIntegrations()
      .then(setIntegrations)
      .catch(() => {})
      .finally(() => setLoading(false));
    listTags()
      .then((existing) => {
        setExistingTagCount(existing.length);
        setTags(initialTagSelection(existing.map((t) => t.name)));
      })
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
  // Vietnam time unless the student already chose something else.
  const suggested = suggestedTimezone(device);
  const effectiveTz =
    tzChoice ??
    (prefs.timezoneMode === "explicit" ? prefs.timezone : suggested);
  const saveTimezone = () =>
    run(async () => {
      // Following the device keeps the app in step when the phone changes zone.
      const value = effectiveTz === device ? DEVICE_TIMEZONE : effectiveTz;
      const unchanged =
        value === DEVICE_TIMEZONE
          ? prefs.timezoneMode === "device"
          : prefs.timezoneMode === "explicit" && prefs.timezone === value;
      if (unchanged) return;
      return (await savePref({ timezone: value })) ? undefined : false;
    });
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
  async function turnOnNotifications(): Promise<
    "on" | "saved" | "blocked" | "failed"
  > {
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
      if (userId) AsyncStorage.removeItem(onboardingStepKey(userId)).catch(() => {});
    } catch {
      toast(COPY.saveFailed, "destructive");
      setBusy(false);
    }
  }

  const progress = stepProgress(step);
  const primary = (label: string, onPress: () => void, disabled = false) => (
    <Button
      size="lg"
      loading={busy}
      disabled={disabled}
      onPress={onPress}
    >
      <Text className="font-semibold text-primary-foreground">{label}</Text>
    </Button>
  );
  const ghost = (label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-11 items-center justify-center py-3"
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
            textContentType="name"
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => name.trim() && void saveName()}
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
          <DluAccountsSection ref={dluRef} hideLabel />
          <Text className="mt-3.5 px-1 text-[12px] leading-snug text-muted-foreground">
            {COPY.dlu.hint}
          </Text>
        </View>
      );
      footer = (
        <>
          {dluConnected
            ? primary(COPY.continue, advance)
            : primary(COPY.dlu.connect, () => dluRef.current?.connect())}
          {!dluConnected && ghost(COPY.dlu.later, advance)}
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
              <Switch
                checked={notif.active}
                onCheckedChange={() => void toggleNotifications()}
                disabled={busy}
                accessibilityLabel={COPY.notifications.rowTitle}
              />
            </View>
          </Group>
          <View className="mt-4 gap-3 px-1">
            {COPY.notifications.bullets.map((b) => (
              <View key={t(b)} className="flex-row items-start gap-2.5">
                <Check size={16} className="mt-0.5 text-primary-text" />
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
                  accessibilityRole="link"
                  className="mt-1 min-h-11 justify-center"
                >
                  <Text className="text-[13.5px] font-semibold text-primary-text">
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
          <View
            accessible
            accessibilityRole="radio"
            accessibilityState={{ checked: true }}
            accessibilityLabel={`${effectiveTz}, ${gmtOffset(effectiveTz)}`}
            className="flex-row items-center gap-3 rounded-2xl border border-primary/50 bg-primary/10 px-4 py-3.5"
          >
            <MapPin size={20} className="text-primary-text" />
            <View className="flex-1">
              <Text className="text-[12.5px] font-semibold text-muted-foreground">
                {COPY.timezone.detected}
              </Text>
              <Text className="text-[15px] font-semibold">
                {effectiveTz}
                <Text className="font-normal text-muted-foreground">
                  {` · ${gmtOffset(effectiveTz)}`}
                </Text>
              </Text>
            </View>
            <RadioDot selected />
          </View>
          <View className="mt-1 flex-row flex-wrap gap-x-5">
            <TextLink
              tone="primary"
              onPress={() => setTzPickerOpen((open) => !open)}
              accessibilityHint={t("Shows every timezone")}
            >
              {tzPickerOpen ? t("Hide list") : COPY.timezone.change}
            </TextLink>
            {effectiveTz !== device && (
              <TextLink
                onPress={() => {
                  setTzChoice(device);
                  setTzPickerOpen(false);
                }}
              >
                {COPY.timezone.useDevice}
              </TextLink>
            )}
          </View>
          {tzPickerOpen && (
            <View>
              <View className="mt-2">
                <Input
                  value={tzQuery}
                  onChangeText={setTzQuery}
                  placeholder={COPY.timezone.search}
                  accessibilityLabel={COPY.timezone.search}
                  autoCapitalize="none"
                  autoCorrect={false}
                  rightElement={
                    <Search size={18} className="text-muted-foreground" />
                  }
                />
              </View>
              <View className="mt-3">
                <Group>
                  {zones.map((z) => {
                    const on = effectiveTz === z;
                    return (
                      <Row
                        key={z}
                        selected={on}
                        onPress={() => {
                          setTzChoice(z);
                          setTzPickerOpen(false);
                        }}
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
          )}
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, saveTimezone)}
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
              ? t("Continue · {count} tags", {
                  count: tagsForBulk(tags).length,
                })
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
      const tagCount = Math.max(savedTagCount, existingTagCount);
      const rows: {
        k: string;
        v: string;
        pending?: boolean;
        step?: OnboardingStep;
      }[] = [
        {
          k: t("DLU account"),
          v: dluConnected ? t("Connected") : t("Not set up yet"),
          pending: !dluConnected,
          step: "dlu",
        },
        { k: t("Name"), v: user?.name ?? "" },
        {
          k: t("Notifications"),
          v: notif.active ? t("On") : t("Not set up yet"),
          pending: !notif.active,
          step: "notifications",
        },
        { k: t("Timezone"), v: prefs.timezone },
        {
          k: t("Default reminder"),
          v:
            REMINDERS.find((r) => r.value === prefs.defaultReminder)?.label ??
            "",
        },
        {
          k: t("Tags"),
          v: tagCount > 0 ? t("{count} tags", { count: tagCount }) : t("Not set up yet"),
          pending: tagCount === 0,
          step: "tags",
        },
      ];
      content = (
        <Group>
          {rows.map((r) => (
            <View
              key={r.k}
              className="min-h-12 flex-row items-center justify-between px-4"
            >
              <Text className="text-[14.5px] font-medium">{r.k}</Text>
              <View className="flex-row items-center gap-2.5">
                <Text className="text-[13px] text-muted-foreground">{r.v}</Text>
                {r.pending && r.step ? (
                  <Pressable
                    onPress={() => {
                      setFromSummary(true);
                      setStep(r.step as OnboardingStep);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("Set up")}: ${r.k}`}
                    className="min-h-11 justify-center px-1"
                  >
                    <Text className="text-[13px] font-semibold text-primary-text">
                      {t("Set up")}
                    </Text>
                  </Pressable>
                ) : (
                  <Check size={16} className="text-success-text" />
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

  // One beat to read the saved step, so a resumed student never sees step one flash by.
  if (!resumed) return <View className="flex-1 bg-background" />;

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
              accessibilityRole="button"
              accessibilityLabel={COPY.back}
              className="size-11 items-center justify-center rounded-xl"
            >
              <ChevronLeft size={22} className="text-foreground" />
            </Pressable>
          ) : (
            <View className="size-11" />
          )}
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t("Step {index} of {total}", {
              index: progress.index,
              total: progress.total,
            })}
            className="flex-1 flex-row gap-1.5"
          >
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
            <View className="mb-5 size-16 items-center justify-center rounded-full bg-brand-orange">
              <Check size={30} className="text-primary-foreground" />
            </View>
          ) : Hero ? (
            <View className="mb-4 size-12 items-center justify-center rounded-2xl bg-primary/10">
              <Hero size={24} className="text-primary-text" />
            </View>
          ) : null}
          <Text
            accessibilityRole="header"
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
