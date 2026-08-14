import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import {
  Controller,
  type Resolver,
  type SubmitHandler,
  useForm,
} from "react-hook-form";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { z } from "zod";

import { requestOtp, verifyOtp } from "@/api/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormInput } from "@/components/ui/form";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { formatCountdown, useCountdown } from "@/hooks/use-countdown";
import { useUserStore } from "@/hooks/use-user-store";
import { cacheSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { hideEmail } from "@/utils/hide-email";
import { Clock, Loader2Icon } from "lucide-react-native";

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
  return (
    <View className="mt-2 flex-row items-start gap-1.5">
      <Clock size={15} className="mt-px shrink-0 text-brand-yellow" />
      <Text className="flex-1 text-[13px] font-medium text-foreground">
        {children}
      </Text>
    </View>
  );
}

const emailSchema = z.object({
  email: z.email({ message: "Invalid email address." }),
});

const otpSchema = z.object({
  email: z.email(),
  otp: z
    .string()
    .length(6, { message: "Your one-time password must be 6 digits." }),
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
  const inputRef = useRef<TextInput>(null);
  const digits = value.padEnd(OTP_LENGTH, " ").split("");

  return (
    <Pressable
      className="flex-row justify-between gap-[9px]"
      onPress={() => !disabled && inputRef.current?.focus()}
    >
      {digits.map((d, i) => (
        <View
          key={i}
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
        maxLength={OTP_LENGTH}
        editable={!disabled}
        autoFocus
        className="absolute h-px w-px opacity-0"
      />
    </Pressable>
  );
}

export default function LoginScreen() {
  const params = useLocalSearchParams<{ callback?: string }>();
  const setUser = useUserStore((state) => state.setUser);
  const { toast } = useToast();

  const [stage, setStage] = useState<"email" | "otp">("email");
  const [submitting, setSubmitting] = useState(false);

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
    clearErrors("email");
    try {
      await requestOtp(data.email);
      toast("Email sent successfully", "info");
      requestLockout.clear();
      setStage("otp");
      form.setValue("otp", "");
      otpLockout.clear();
      resendCooldown.start(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 429) {
        requestLockout.start(getRetryAfterSeconds(error));
      } else {
        const message =
          isAxiosError(error) && error.response
            ? error.response.data?.message ??
              "Failed to send OTP. Please try again."
            : "Network error. Could not connect to the server.";
        setError("email", { type: "manual", message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpVerify = async (data: OtpFormValues) => {
    if (otpLockout.active) return;
    setSubmitting(true);
    clearErrors("otp");
    try {
      const result = await verifyOtp(getValues("email"), data.otp);
      toast("Login successfully", "success");
      setUser(result.data);
      await cacheSessionUser(result.data);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 429) {
        otpLockout.start(getRetryAfterSeconds(error));
      } else {
        const message =
          isAxiosError(error) && error.response
            ? error.response.data?.message ??
              "Failed to verify OTP. Please try again."
            : "Network error. Could not connect to the server.";
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

  return (
    <View className="flex-1 bg-background px-5">
      <View className="flex-1 justify-center">
        <View className="items-center gap-3.5 pb-[26px]">
          <Logo className="h-[60px] w-[60px] rounded-full shadow-lg shadow-brand-orange/30" />
          <View className="items-center gap-1">
            <Text className="text-[22px] font-bold tracking-[-0.02em]">
              {stage === "email" ? "Login to Zenflow" : "Enter your code"}
            </Text>
            <Text className="text-[14px] text-muted-foreground">
              {stage === "email"
                ? "A focus-first planner that schedules for you."
                : `Sent to ${hideEmail(email)}`}
            </Text>
          </View>
        </View>

        <Form {...form}>
          {stage === "email" ? (
            <View>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormInput
                    name={field.name}
                    label="Email"
                    labelClassName="text-[14px] font-semibold"
                    placeholder="m@example.com"
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
              {requestLockout.active && (
                <LockoutNotice>
                  Too many requests. Please wait before trying again.
                </LockoutNotice>
              )}
            </View>
          ) : (
            <View>
              <Pressable
                disabled={otpLockout.active}
                onPress={() => {
                  if (otpLockout.active) return;
                  setStage("email");
                  form.setValue("otp", "");
                  clearErrors();
                  otpLockout.clear();
                  resendCooldown.clear();
                }}
              >
                <Text
                  className={cn(
                    "text-[13px] font-semibold underline underline-offset-[3px]",
                    otpLockout.active && "text-muted-foreground opacity-50",
                  )}
                >
                  Change email
                </Text>
              </Pressable>
              <Controller
                control={form.control}
                name="otp"
                render={({ field, fieldState }) => (
                  <View className="mt-[18px] mb-[18px] gap-2">
                    <Text className="text-[14px] font-semibold">
                      One-Time Password
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
                      <Text className="text-sm font-medium text-destructive">
                        {fieldState.error.message}
                      </Text>
                    )}
                    {otpLockout.active && (
                      <LockoutNotice>
                        Too many attempts. Try again in{" "}
                        {formatCountdown(otpLockout.remaining)}.
                      </LockoutNotice>
                    )}
                  </View>
                )}
              />
              {submitting ? (
                <View className="flex-row items-center justify-center gap-[9px]">
                  <ActivityIndicator
                    className="mr-2"
                    size="small"
                    color="black"
                  />
                  <Text className="text-[14px] text-muted-foreground">
                    Verifying code…
                  </Text>
                </View>
              ) : otpLockout.active ? (
                <View className="h-12 w-full flex-row items-center justify-center rounded-xl opacity-50">
                  <Text className="text-sm font-semibold text-muted-foreground">
                    Resend code
                  </Text>
                </View>
              ) : requestLockout.active ? (
                <View className="h-12 w-full flex-row items-center justify-center gap-2 rounded-xl opacity-50">
                  <Clock size={16} className="text-muted-foreground" />
                  <Text className="text-sm font-semibold tabular-nums text-muted-foreground">
                    Try again in {formatCountdown(requestLockout.remaining)}
                  </Text>
                </View>
              ) : resendCooldown.active ? (
                <View className="h-12 w-full flex-row items-center justify-center gap-2 rounded-xl opacity-50">
                  <Clock size={16} className="text-muted-foreground" />
                  <Text className="text-sm font-semibold tabular-nums text-muted-foreground">
                    Resend code in {formatCountdown(resendCooldown.remaining)}
                  </Text>
                </View>
              ) : (
                <Button
                  variant="ghost"
                  disabled={submitting}
                  onPress={() => handleEmailRequest({ email })}
                  className="w-full rounded-xl"
                >
                  <Text className="text-sm font-semibold text-muted-foreground">
                    Resend code
                  </Text>
                </Button>
              )}
            </View>
          )}

          {stage === "email" &&
            (requestLockout.active ? (
              <View className="mt-[18px] h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-muted">
                <Clock size={18} className="text-muted-foreground" />
                <Text className="text-base font-semibold tabular-nums text-muted-foreground">
                  Try again in {formatCountdown(requestLockout.remaining)}
                </Text>
              </View>
            ) : (
              <Button
                className="mt-[18px] flex-row h-[52px] rounded-xl"
                disabled={submitting}
                onPress={handleSubmit(onSubmit)}
              >
                {submitting && (
                  <ActivityIndicator
                    className="mr-2"
                    size="small"
                    color="black"
                  />
                )}
                <Text
                  className={cn(
                    "font-semibold text-primary-foreground",
                    submitting && "text-primary-foreground/70",
                  )}
                >
                  {submitting ? "Sending…" : "Send OTP"}
                </Text>
              </Button>
            ))}
        </Form>

        <Text className="mt-[22px] px-2.5 text-center text-[12px] leading-normal text-muted-foreground">
          By continuing, you agree to our{" "}
          <Text className="text-[12px] text-foreground underline underline-offset-2">
            Terms of Service
          </Text>{" "}
          and{" "}
          <Text className="text-[12px] text-foreground underline underline-offset-2">
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
    </View>
  );
}
