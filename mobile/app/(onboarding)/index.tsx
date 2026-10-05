import { listIntegrations } from "@/api/integrations";
import { createTagsBulk, listTags } from "@/api/tags";
import { updateBasicInfo } from "@/api/users";
import { ChevronLeft } from "@/components/Icons";
import { TagPicker } from "@/components/onboarding/tag-picker";
import { DluAccountsSection } from "@/components/settings/dlu-accounts-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useNotificationToggle } from "@/hooks/use-notification-toggle";
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
} from "@/lib/onboarding";
import {
  LANGUAGES,
  REMINDERS,
  allTimezones,
  deviceTimezone,
} from "@/lib/preferences";
import { DEVICE_TIMEZONE } from "@/lib/preferences-sync";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import {
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
    title: "Pick a language",
    body: "You can change it anytime in Settings.",
  },
  name: {
    title: "What's your name?",
    body: "We'll use it in the app and reminders.",
    label: "Name",
  },
  dlu: {
    title: "Connect DLU",
    body: "Link your account and we'll keep your timetable, exams and assignments up to date.",
    hint: "You can do this later in Settings.",
  },
  notifications: {
    title: "Never miss a deadline",
    body: "Get a heads-up before sessions and when your schedule changes.",
    bullets: [
      "Reminders before each session",
      "Timetable and exam changes",
      "New assignments",
    ],
    enable: "Turn on notifications",
    notNow: "Not now",
    blockedTitle: "Notifications are off",
    blockedBody: "Allow them in system settings to get reminders.",
    openSettings: "Open settings",
  },
  timezone: {
    title: "Where are you?",
    body: "So reminders land at the right local time.",
    detected: "From your device",
    search: "Search timezones",
  },
  reminder: {
    title: "Default reminder",
    body: "How early should we remind you? You can change it per task.",
  },
  tags: {
    title: "Pick your tags",
    body: "Tags help you organize tasks. Tap to keep, or add your own.",
    footer: (n: number) => `${n} selected`,
  },
  done: {
    title: "You're all set",
    body: "Anything you skipped is in Settings.",
    open: "Open calendar",
  },
  saveFailed: "Couldn't save. Try again.",
} as const;

function Choice({
  label,
  selected,
  onPress,
  hint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  hint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={cn(
        "flex-row items-center justify-between rounded-2xl border px-4 py-4",
        selected ? "border-primary bg-primary/10" : "border-border bg-card",
      )}
    >
      <Text className="text-[15px] font-semibold">{label}</Text>
      {hint ? (
        <Text className="text-[13px] text-muted-foreground">{hint}</Text>
      ) : null}
    </Pressable>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);
  const { setIntegrations, setLoading, integrations } = useIntegrationStore();
  const notif = useNotificationToggle();
  const { prefs, update } = notif;

  // Local UI step index only; every value below is persisted server-side.
  const [step, setStep] = useState<OnboardingStep>(FIRST_STEP);
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

  const go = () => setStep((s) => nextStep(s));
  const dluConnected = integrations.some((i) => i.connected);
  const device = deviceTimezone();
  const zones = useMemo(
    () => filterTimezones(allTimezones(), tzQuery),
    [tzQuery],
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

  async function savePref(patch: Parameters<typeof update>[0]) {
    if (await update(patch)) return true;
    toast(COPY.saveFailed, "destructive");
    return false;
  }

  const saveName = () =>
    run(async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === user?.name) return;
      setUser(await updateBasicInfo({ name: trimmed }));
    });

  const saveTags = () =>
    run(async () => {
      const names = tagsForBulk(tags);
      if (names.length > 0) await createTagsBulk(names);
      setSavedTagCount(names.length);
    });

  async function enableNotifications() {
    setBusy(true);
    const ok = await notif.setEnabled(true);
    if (ok) {
      setBusy(false);
      go();
      return;
    }
    setBlocked(true);
    setBusy(false);
  }

  async function notNow() {
    await notif.setEnabled(false);
    go();
  }

  async function finish() {
    setBusy(true);
    try {
      // Idempotent; the root AuthGate then routes to the app.
      setUser(await updateBasicInfo({ onboarded: true }));
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
        <View className="gap-3">
          {LANGUAGES.map((l) => (
            <Choice
              key={l.value}
              label={l.label}
              selected={prefs.language === l.value}
              onPress={() => void savePref({ language: l.value })}
            />
          ))}
        </View>
      );
      footer = primary(COPY.continue, go);
      break;
    case "name":
      ({ title, body } = COPY.name);
      content = (
        <View className="gap-2">
          <Text className="text-[13px] font-semibold">{COPY.name.label}</Text>
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
          {ghost(COPY.skipForNow, go)}
        </>
      );
      break;
    case "dlu":
      ({ title, body } = COPY.dlu);
      content = (
        <View>
          <DluAccountsSection hideLabel />
          <Text className="mt-3 text-[13px] text-muted-foreground">
            {COPY.dlu.hint}
          </Text>
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, go)}
          {!dluConnected && ghost(COPY.skipForNow, go)}
        </>
      );
      break;
    case "notifications":
      ({ title, body } = COPY.notifications);
      content = (
        <View className="gap-3">
          {COPY.notifications.bullets.map((b) => (
            <Text key={b} className="text-[15px]">
              {"•  "}
              {b}
            </Text>
          ))}
          {blocked && (
            <View className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
              <Text className="text-[14px] font-semibold">
                {COPY.notifications.blockedTitle}
              </Text>
              <Text className="mt-1 text-[13px] text-muted-foreground">
                {COPY.notifications.blockedBody}
              </Text>
              <Pressable
                onPress={() => void Linking.openSettings()}
                className="mt-3"
              >
                <Text className="text-[14px] font-semibold text-primary">
                  {COPY.notifications.openSettings}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      );
      footer = (
        <>
          {primary(
            blocked ? COPY.continue : COPY.notifications.enable,
            blocked ? go : enableNotifications,
          )}
          {!blocked && ghost(COPY.notifications.notNow, notNow)}
        </>
      );
      break;
    case "timezone":
      ({ title, body } = COPY.timezone);
      content = (
        <View className="gap-3">
          <Choice
            label={COPY.timezone.detected}
            hint={device}
            selected={prefs.timezoneMode === "device"}
            onPress={() => void savePref({ timezone: DEVICE_TIMEZONE })}
          />
          <Input
            value={tzQuery}
            onChangeText={setTzQuery}
            placeholder={COPY.timezone.search}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {zones.map((z) => (
            <Choice
              key={z}
              label={z}
              selected={
                prefs.timezoneMode === "explicit" && prefs.timezone === z
              }
              onPress={() => void savePref({ timezone: z })}
            />
          ))}
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, go)}
          {ghost(COPY.skipForNow, go)}
        </>
      );
      break;
    case "reminder":
      ({ title, body } = COPY.reminder);
      content = (
        <View className="gap-3">
          {REMINDERS.map((r) => (
            <Choice
              key={r.value}
              label={r.label}
              selected={prefs.defaultReminder === r.value}
              onPress={() => void savePref({ defaultReminder: r.value })}
            />
          ))}
        </View>
      );
      footer = (
        <>
          {primary(COPY.continue, go)}
          {ghost(COPY.skipForNow, go)}
        </>
      );
      break;
    case "tags":
      ({ title, body } = COPY.tags);
      content = tagsLoaded ? (
        <View>
          <TagPicker selected={tags} onChange={setTags} />
          <Text className="mt-4 text-[13px] text-muted-foreground">
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
          {ghost(COPY.skipForNow, go)}
        </>
      );
      break;
    case "done":
      ({ title, body } = COPY.done);
      content = (
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          {[
            [
              "Language",
              LANGUAGES.find((l) => l.value === prefs.language)?.label ?? "",
            ],
            ["Name", user?.name ?? ""],
            ["DLU account", dluConnected ? "Connected" : "Skipped"],
            ["Notifications", notif.active ? "On" : "Skipped"],
            ["Timezone", prefs.timezone],
            [
              "Default reminder",
              REMINDERS.find((r) => r.value === prefs.defaultReminder)?.label ??
                "",
            ],
            ["Tags", `${savedTagCount} selected`],
          ].map(([k, v], i) => (
            <View
              key={k}
              className={cn(
                "flex-row justify-between px-4 py-3.5",
                i > 0 && "border-t border-border",
              )}
            >
              <Text className="text-[15px] font-semibold">{k}</Text>
              <Text className="text-[14px] text-muted-foreground">{v}</Text>
            </View>
          ))}
        </View>
      );
      footer = primary(COPY.done.open, finish);
      break;
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        className="flex-row items-center justify-between px-5 pb-2"
        style={{ paddingTop: insets.top + 8 }}
      >
        {canGoBack(step) ? (
          <Pressable
            onPress={() => setStep((s) => prevStep(s))}
            hitSlop={8}
            accessibilityLabel={COPY.back}
            className="size-9 items-center justify-center"
          >
            <ChevronLeft size={22} className="text-foreground" />
          </Pressable>
        ) : (
          <View className="size-9" />
        )}
        {step !== "done" ? (
          <>
            <Text className="text-[13px] text-muted-foreground">
              {progress.index} / {progress.total}
            </Text>
            <Pressable
              onPress={() => {
                setBlocked(false);
                go();
              }}
              hitSlop={8}
              disabled={busy}
            >
              <Text className="text-[14px] font-medium text-muted-foreground">
                {COPY.skip}
              </Text>
            </Pressable>
          </>
        ) : (
          <View className="size-9" />
        )}
      </View>
      <ScrollView
        className="flex-1 px-6"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <Text className="mt-4 text-2xl font-bold tracking-tight">{title}</Text>
        <Text className="mb-6 mt-2 text-[15px] text-muted-foreground">
          {body}
        </Text>
        {content}
      </ScrollView>
      <View
        className="gap-1 px-6 pt-2"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        {footer}
      </View>
    </KeyboardAvoidingView>
  );
}
