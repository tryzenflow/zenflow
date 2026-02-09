import { zodResolver } from "@hookform/resolvers/zod";
import React, { useState } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { hideEmail } from "../../utils/hide-email";
import { useUserStore } from "../../hooks/use-user-store";
import { requestOtp, verifyOtp } from "@/api/auth";
import { isAxiosError } from "axios";

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

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate();
  const setUser = useUserStore((state) => state.setUser);
  const [stage, setStage] = useState<"email" | "otp">("email");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(stage === "email" ? emailSchema : otpSchema),
    defaultValues: {
      email: "",
      otp: "",
    },
    mode: "onBlur",
  });

  const { handleSubmit, setError, clearErrors, watch, getValues, trigger } =
    form;

  const email = watch("email");

  const handleEmailRequest = async (data: EmailFormValues) => {
    setLoading(true);
    setApiError(null);
    clearErrors("email");

    try {
      await requestOtp(data.email);

      toast.info("Email sent successfully");
      setStage("otp");
      clearErrors();

      trigger("otp");
    } catch (error) {
      if (isAxiosError(error) && error.status === 400) {
        const errorMessage =
          error.response?.data.message ||
          "Failed to send OTP. Please try again.";
        setError("email", { type: "manual", message: errorMessage });
      }
      setError("email", {
        type: "manual",
        message: "Network error. Could not connect to the server.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerify = async (data: OtpFormValues) => {
    if (stage !== "otp") return;

    setLoading(true);
    setApiError(null);
    clearErrors("otp");

    try {
      const emailForApi = getValues("email");

      const result = await verifyOtp(emailForApi, data.otp);

      toast.success("Login successfully");
      setUser(result.data);
      navigate("/");
    } catch (error) {
      if (isAxiosError(error) && error.status === 400) {
        const errorMessage =
          error.response?.data.message ||
          "Failed to verify OTP. Please try again.";
        setError("otp", { type: "manual", message: errorMessage });
      }
      setError("otp", {
        type: "manual",
        message: "Network error. Could not connect to the server.",
      });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    if (stage === "email") {
      await handleEmailRequest(data as EmailFormValues);
    } else {
      await handleOtpVerify(data as OtpFormValues);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Form {...form}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <a
              href="#"
              className="flex flex-col items-center gap-2 font-medium"
            >
              <div className="flex size-8 items-center justify-center rounded-md">
                <img src="/logo.svg" width="64px" height="64px" />
              </div>
              <span className="sr-only">Zenflow</span>
            </a>
            <h1 className="text-xl font-bold">Login to Zenflow</h1>
          </div>

          {/* STAGE 1: EMAIL FIELD (Visible only in email stage) */}
          {stage === "email" && (
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="m@example.com"
                      type="email"
                      autoComplete="email"
                      disabled={loading}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* STAGE 2: OTP INPUT FIELD (Visible only in otp stage) */}
          {stage === "otp" && (
            <FormField
              control={form.control}
              name="otp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>One-Time Password</FormLabel>
                  <FormDescription className="pt-1 pb-2">
                    Enter the OTP code sent to {hideEmail(email)}.
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setStage("email");
                        form.setValue("otp", "");
                        clearErrors();
                      }}
                      className="text-sm ml-3 underline-offset-2 font-medium underline"
                    >
                      Change Email
                    </a>
                  </FormDescription>
                  <FormControl>
                    <div>
                      <InputOTP
                        maxLength={6}
                        disabled={loading}
                        {...field}
                        onComplete={handleSubmit(onSubmit)}
                      >
                        <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                  </FormControl>
                  <FormMessage />
                  <Button
                    variant="link"
                    type="button"
                    onClick={async () => await handleEmailRequest({ email })}
                    className="text-sm underline-offset-2 w-fit p-0 text-muted-foreground font-medium hover:underline"
                  >
                    Resend code
                  </Button>
                </FormItem>
              )}
            />
          )}

          {/* Global API Error Display (only if no field error is set) */}
          {apiError && (
            <p className="text-sm font-medium text-destructive">{apiError}</p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {stage === "email" ? "Send OTP" : "Login"}
          </Button>
        </form>
      </Form>
      <p className="px-6 text-center text-sm text-muted-foreground">
        By clicking continue, you agree to our{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
