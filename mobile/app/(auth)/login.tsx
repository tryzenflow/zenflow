import { getLanguage, t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Controller,
  type Resolver,
  type SubmitHandler,
  useForm,
} from "react-hook-form";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  type TextInputInstance,
  View,
} from "react-native";
import type { User } from "@zenflow/shared";
import { z } from "zod";

import { requestOtp, verifyOtp } from "@/api/auth";
import { updateBasicInfo } from "@/api/users";
import { LanguageSelect } from "@/components/language-select";
import { PlannedDayPreview } from "@/components/auth/planned-day-preview";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormInput } from "@/components/ui/form";
import { Text } from "@/components/ui/text";
import { TextLink } from "@/components/ui/text-link";
import { useToast } from "@/components/ui/toast";
import { formatCountdown, useCountdown } from "@/hooks/use-countdown";
import { useUserStore } from "@/hooks/use-user-store";
import { NAV_THEME } from "@/lib/constants";
import { cacheSessionUser } from "@/lib/session";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import { hideEmail } from "@/utils/hide-email";
import { Clock, Loader2Icon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Client-side proactive throttle on "Resend code" — shorter than the
 * server's real per-email limit (LimitKit, #14: 3 req/15min on
 * `/auth/otp/request`) so users can't spam the button into tripping it.
 */
const RESEND_COOLDOWN_SECONDS = 30;

/** Fallback when a 429's `Retry-After` header is missing/unparseable. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

/**
 * Reads the `Retry-After` seconds off a 429 axios error (case-insensitive
 * lowercased by axios), falling back to a sane default rather than
 * crashing/hanging if it's missing or not a number.
 */
function getRetryAfterSeconds(error: unknown): number {
  if (isAxiosError(error)) {
    const header = error.response?.headers?.["retry-after"];
    const parsed = Number(header);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/** Amber clock icon + message, matching mockups/login.html's "Locked" frames. */
function LockoutNotice({ children }: { children: ReactNode }) {
  useLanguage();
  return (
    <View className="mt-2 flex-row items-start gap-1.5">
      <Clock size={15} className="mt-px shrink-0 text-warning" />
      <Text className="flex-1 text-[13px] font-medium text-foreground">
        {children}
      </Text>
    </View>
  );
}

const emailSchema = z.object({
  email: z.email({
    get message() {
      return t("Invalid email address.");
    },
  }),
});

const otpSchema = z.object({
  email: z.email(),
  otp: z.string().length(6, {
    get message() {
      return t("Your sign-in code must be 6 digits.");
    },
  }),
});

type EmailFormValues = z.infer<typeof emailSchema>;
type OtpFormValues = z.infer<typeof otpSchema>;
type FormValues = EmailFormValues & Partial<OtpFormValues>;

const OTP_LENGTH = 6;

/** 6-box OTP display driven by a single hidden TextInput (RN has no native multi-slot input). */
function OtpBoxes({
  value,
  onChangeText,
  error,
  disabled,
}: {
  value: string;
  onChangeText: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
}) {
  useLanguage();
  // RN 0.88: ref instance type is `TextInputInstance`, not `TextInput` -- see
  // day-timeline.tsx's `scrollRef` comment.
  const inputRef = useRef<TextInputInstance>(null);
  const digits = value.padEnd(OTP_LENGTH, " ").split("");

  return (
    <Pressable
      accessible={false}
      className="flex-row justify-between gap-[9px]"
      onPress={() => !disabled && inputRef.current?.focus()}
    >
      {digits.map((d, i) => (
        <View
          key={i}
          // The hidden input below is the one accessible control; the boxes
          // only draw its value.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className={cn(
            "flex-1 aspect-[1/1.18] max-w-[52px] items-center justify-center rounded-xl border border-input bg-card",
            !error && i < value.length && "border-ring/50",
            !error &&
              value.length === i &&
              "border-ring web:ring-[3px] web:ring-ring/50",
            error && "border-destructive",
          )}
        >
          <Text
            className={cn(
              "text-[26px] font-semibold tabular-nums",
              error && "text-destructive",
            )}
          >
            {d.trim()}
          </Text>
        </View>
      ))}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(v) =>
          onChangeText(v.replace(/[^0-9]/g, "").slice(0, OTP_LENGTH))
        }
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        accessibilityLabel={t("Sign-in code")}
        accessibilityHint={t("Enter the 6-digit code from your email")}
        accessibilityValue={{
          text: t("{count} of {total} digits entered", {
            count: value.length,
            total: OTP_LENGTH,
          }),
        }}
        maxLength={OTP_LENGTH}
        editable={!disabled}
        autoFocus
        className="absolute h-px w-px opacity-0"
      />
    </Pressable>
  );
}

export default function LoginScreen() {
  useLanguage();
  const params = useLocalSearchParams<{ callback?: string }>();
  const setUser = useUserStore((state) => state.setUser);
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const keyboardOpen = useKeyboardOpen();

  const [stage, setStage] = useState<"email" | "otp">("email");
  const [submitting, setSubmitting] = useState(false);
  // True after a request that never reached the server, so the error can offer
  // a retry instead of a dead end.
  const [offline, setOffline] = useState(false);

  // Rate-limit UI state (issue #14 — LimitKit on the backend):
  // - `requestLockout`: server 429 from `POST /auth/otp/request`. Disables
  //   the stage-1 email field + button behind a `Retry-After` countdown;
  //   also doubles as a fallback if a stage-2 "Resend code" tap happens to
  //   trip the same endpoint's limit.
  // - `resendCooldown`: proactive client-side throttle on "Resend code",
  //   started on every successful `requestOtp` (initial send + resend),
  //   independent of any 429 — see `RESEND_COOLDOWN_SECONDS` above.
  // - `otpLockout`: server 429 from `POST /auth/otp/verify`. Freezes the
  //   whole stage-2 form (OTP boxes, Resend, Change email).
  const requestLockout = useCountdown();
  const resendCooldown = useCountdown();
  const otpLockout = useCountdown();

  const form = useForm<FormValues>({
    resolver: zodResolver(
      stage === "email" ? emailSchema : otpSchema,
    ) as Resolver<FormValues>,
    defaultValues: { email: "", otp: "" },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  const { handleSubmit, setError, clearErrors, watch, getValues } = form;
  const email = watch("email");

  // No local redirect here: the root layout's `AuthGate` is the single
  // source of truth for post-auth navigation and reacts to `setUser` below
  // on its own. A screen-local `router.replace` here used to race it.

  const handleEmailRequest = async (data: EmailFormValues) => {
    if (requestLockout.active) return;
    setSubmitting(true);
    setOffline(false);
    clearErrors("email");
    try {
      await requestOtp(data.email);
      toast(t("Check your inbox"), "info");
      requestLockout.clear();
      setStage("otp");
      form.setValue("otp", "");
      otpLockout.clear();
      resendCooldown.start(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 429) {
        requestLockout.start(getRetryAfterSeconds(error));
      } else {
        setOffline(!(isAxiosError(error) && error.response));
        const message =
          isAxiosError(error) && error.response
            ? (error.response.data?.message ??
              t("Couldn't send the code. Try again."))
            : t("No connection. Check your internet and try again.");
        setError("email", { type: "manual", message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpVerify = async (data: OtpFormValues) => {
    if (otpLockout.active) return;
    setSubmitting(true);
    setOffline(false);
    clearErrors("otp");
    try {
      const result = await verifyOtp(getValues("email"), data.otp);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      let user: User = result.data;
      // A first sign-in is oriented ("a few questions, then your day"); a
      // returning student just gets a quiet welcome.
      if (user.onboardedAt) toast(t("Welcome back"), "success");
      else
        toast({
          title: t("Welcome to Zenflow"),
          description: t("A few quick questions, then your day is ready."),
          variant: "success",
        });
      // The language shown on this screen (the top-right select, or the
      // Vietnamese default) overrides the account's stored preference.
      const language = getLanguage();
      if (user.lang !== language) {
        try {
          user = await updateBasicInfo({ lang: language });
        } catch {
          // Offline blip — the account's own language applies instead.
        }
      }
      setUser(user);
      await cacheSessionUser(user);
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
      if (isAxiosError(error) && error.response?.status === 429) {
        otpLockout.start(getRetryAfterSeconds(error));
      } else {
        setOffline(!(isAxiosError(error) && error.response));
        const message =
          isAxiosError(error) && error.response
            ? (error.response.data?.message ??
              t("Couldn't verify the code. Try again."))
            : t("No connection. Check your internet and try again.");
        setError("otp", { type: "manual", message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    if (stage === "email") await handleEmailRequest(data as EmailFormValues);
    else await handleOtpVerify(data as OtpFormValues);
  };

  const retry = offline ? (
    <TextLink
      tone="primary"
      onPress={() => void handleSubmit(onSubmit)()}
      accessibilityHint={t("Sends the request again")}
    >
      {t("Try again")}
    </TextLink>
  ) : null;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        className="absolute right-5 z-10"
        style={{ top: insets.top + 8 }}
      >
        <LanguageSelect />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="flex-grow justify-center px-5"
        contentContainerStyle={{
          paddingTop: insets.top + 56,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
        }}
      >
        <View className="items-center gap-3 pb-4">
          <Logo className="h-12 w-12 rounded-full shadow-lg shadow-brand-orange/30" />
          <View className="items-center gap-1">
            <Text
              accessibilityRole="header"
              className="text-center text-title font-bold tracking-[-0.02em]"
            >
              {stage === "email"
                ? t("Your DLU schedule, planned for you")
                : t("Enter your code")}
            </Text>
            <Text className="text-center text-sm text-muted-foreground">
              {stage === "email"
                ? t("Add what's due. Zenflow picks the time.")
                : t("Sent to {email}", { email: hideEmail(email) })}
            </Text>
          </View>
        </View>

        {stage === "email" && !keyboardOpen ? (
          <View className="mb-5">
            <PlannedDayPreview />
          </View>
        ) : null}

        <Form {...form}>
          {stage === "email" ? (
            <View>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormInput
                    name={field.name}
                    label={t("Email")}
                    labelClassName="text-sm font-semibold"
                    placeholder="mssv@dlu.edu.vn"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    editable={!submitting && !requestLockout.active}
                    value={field.value}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    className="h-[50px] rounded-xl bg-card px-4 dark:bg-input/30 web:focus-visible:border-ring web:focus-visible:ring-ring/50 web:focus-visible:ring-[3px]"
                  />
                )}
              />
              {retry}
              {requestLockout.active && (
                <LockoutNotice>
                  {t("Too many requests. Wait a moment, then try again.")}
                </LockoutNotice>
              )}
            </View>
          ) : (
            <View>
              <TextLink
                disabled={otpLockout.active}
                onPress={() => {
                  if (otpLockout.active) return;
                  setStage("email");
                  setOffline(false);
                  form.setValue("otp", "");
                  clearErrors();
                  otpLockout.clear();
                  resendCooldown.clear();
                }}
              >
                {t("Change email")}
              </TextLink>
              <Controller
                control={form.control}
                name="otp"
                render={({ field, fieldState }) => (
                  <View className="mb-3 mt-1 gap-2">
                    <Text className="text-sm font-semibold">
                      {t("Sign-in code")}
                    </Text>
                    <View className={cn(otpLockout.active && "opacity-50")}>
                      <OtpBoxes
                        value={field.value ?? ""}
                        onChangeText={(v) => {
                          field.onChange(v);
                          if (v.length === OTP_LENGTH) {
                            handleSubmit(onSubmit)();
                          }
                        }}
                        error={!!fieldState.error}
                        disabled={submitting || otpLockout.active}
                      />
                    </View>
                    {fieldState.error && (
                      <Text
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                        className="text-sm font-medium text-destructive"
                      >
                        {fieldState.error.message}
                      </Text>
                    )}
                    {fieldState.error ? retry : null}
                    {otpLockout.active && (
                      <LockoutNotice>
                        {t("Too many attempts. Try again in")}{" "}
                        {formatCountdown(otpLockout.remaining)}.
                      </LockoutNotice>
                    )}
                  </View>
                )}
              />
              {/* One fixed-height row for every state, so swapping between the
                  resend button and the cooldown never moves the page. */}
              <View className="h-12 w-full items-center justify-center">
                {submitting ? (
                  <View
                    accessibilityLiveRegion="polite"
                    className="flex-row items-center justify-center gap-[9px]"
                  >
                    <ActivityIndicator
                      size="small"
                      color={palette.mutedForeground}
                    />
                    <Text className="text-sm text-muted-foreground">
                      {t("Verifying code…")}
                    </Text>
                  </View>
                ) : otpLockout.active ? (
                  <View className="h-12 w-full flex-row items-center justify-center rounded-xl opacity-50">
                    <Text className="text-sm font-semibold text-muted-foreground">
                      {t("Resend code")}
                    </Text>
                  </View>
                ) : requestLockout.active ? (
                  <View className="h-12 w-full flex-row items-center justify-center gap-2 rounded-xl opacity-50">
                    <Clock size={16} className="text-muted-foreground" />
                    <Text className="text-sm font-semibold tabular-nums text-muted-foreground">
                      {t("Try again in")}{" "}
                      {formatCountdown(requestLockout.remaining)}
                    </Text>
                  </View>
                ) : resendCooldown.active ? (
                  <View className="h-12 w-full flex-row items-center justify-center gap-2 rounded-xl opacity-50">
                    <Clock size={16} className="text-muted-foreground" />
                    <Text className="text-sm font-semibold tabular-nums text-muted-foreground">
                      {t("Resend code in")}{" "}
                      {formatCountdown(resendCooldown.remaining)}
                    </Text>
                  </View>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={submitting}
                    onPress={() => handleEmailRequest({ email })}
                    accessibilityLabel={t("Resend code")}
                    className="h-12 w-full rounded-xl"
                  >
                    <Text className="text-sm font-semibold text-muted-foreground">
                      {t("Resend code")}
                    </Text>
                  </Button>
                )}
              </View>
              <Text className="mt-1 text-center text-xs leading-4 text-muted-foreground">
                {t("Didn't get it? Check your spam folder.")}
              </Text>
            </View>
          )}

          {stage === "email" &&
            (requestLockout.active ? (
              <View className="mt-[18px] h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-muted">
                <Clock size={18} className="text-muted-foreground" />
                <Text className="text-base font-semibold tabular-nums text-muted-foreground">
                  {t("Try again in")}{" "}
                  {formatCountdown(requestLockout.remaining)}
                </Text>
              </View>
            ) : (
              <Button
                className="mt-[18px] flex-row h-[52px] rounded-xl"
                disabled={submitting}
                accessibilityLabel={
                  submitting ? t("Sending…") : t("Send sign-in code")
                }
                accessibilityState={{ busy: submitting, disabled: submitting }}
                onPress={handleSubmit(onSubmit)}
              >
                {submitting && (
                  <ActivityIndicator
                    className="mr-2"
                    size="small"
                    color={NAV_THEME.light.primaryForeground}
                  />
                )}
                <Text
                  className={cn(
                    "font-semibold text-primary-foreground",
                    submitting && "text-primary-foreground/70",
                  )}
                >
                  {submitting ? t("Sending…") : t("Send sign-in code")}
                </Text>
              </Button>
            ))}
        </Form>

        {/* Plain text, not links: the app has no Terms or Privacy URL in its
            config to open yet. */}
        <Text className="mt-[18px] px-2.5 text-center text-xs leading-normal text-muted-foreground">
          {t("By continuing, you agree to our")}{" "}
          <Text className="text-xs text-foreground underline underline-offset-2">
            {t("Terms of Service")}
          </Text>{" "}
          {t("and")}{" "}
          <Text className="text-xs text-foreground underline underline-offset-2">
            {t("Privacy Policy")}
          </Text>
          .
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** True while the software keyboard is up (the hero preview steps aside for it). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}
