import {
  connectIntegration,
  disconnectIntegration,
  getIntegrationStatus,
} from "@/api/dlu";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  CreditCard,
  Eye,
  EyeOff,
  GraduationCap,
} from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Muted } from "@/components/ui/typography";
import { useToast } from "@/components/ui/toast";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { IntegrationProvider, IntegrationStatus } from "@zenflow/shared";

function ProviderIcon({
  provider,
  connected,
}: {
  provider: IntegrationProvider;
  connected: boolean;
}) {
  const Icon = provider === "LMS" ? GraduationCap : CreditCard;
  return (
    <View
      className={
        "inline-flex size-[38px] items-center justify-center rounded-xl shrink-0 " +
        (connected
          ? "bg-emerald-500/15 text-emerald-600"
          : "bg-muted text-muted-foreground")
      }
    >
      <Icon
        size={18}
        className={connected ? "text-emerald-600" : "text-muted-foreground"}
      />
    </View>
  );
}

function formatLastVerified(dateString: string | null): string {
  if (!dateString) return "Not connected";
  try {
    const diff = Date.now() - new Date(dateString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Connected · checked just now";
    if (minutes < 60) return `Connected · checked ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Connected · checked ${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `Connected · checked ${days}d ago`;
  } catch {
    return "Connected";
  }
}

export function ConnectDluAccountScreen({ onBack }: { onBack?: () => void }) {
  const { toast } = useToast();
  const { integrations, loading, setIntegrations, updateIntegration } =
    useIntegrationStore();
  const [selectedProvider, setSelectedProvider] =
    useState<IntegrationProvider | null>(null);
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signInSheet = useBottomSheet();
  const confirmSheet = useBottomSheet();

  const refreshStatus = useCallback(async () => {
    try {
      const res = await getIntegrationStatus();
      setIntegrations(res.integrations);
    } catch {
      // Ignore - toast will be shown by the calling action
    }
  }, [setIntegrations]);

  useEffect(() => {
    if (loading) {
      refreshStatus();
    }
  }, [loading, refreshStatus]);

  const getProviderStatus = (
    provider: IntegrationProvider,
  ): IntegrationStatus | undefined =>
    integrations?.find((i) => i.provider === provider);

  const isConnected = (provider: IntegrationProvider): boolean => {
    const status = getProviderStatus(provider);
    return status?.connected ?? false;
  };

  const openSignInSheet = (provider: IntegrationProvider) => {
    setSelectedProvider(provider);
    setError(null);
    setStudentId("");
    setPassword("");
    setShowPassword(false);
    signInSheet.open();
  };

  const openDisconnectConfirm = (provider: IntegrationProvider) => {
    setSelectedProvider(provider);
    confirmSheet.open();
  };

  const closeSignInSheet = () => {
    signInSheet.close();
    setSelectedProvider(null);
    setStudentId("");
    setPassword("");
    setError(null);
    setShowPassword(false);
  };

  const closeConfirmSheet = () => {
    confirmSheet.close();
    setSelectedProvider(null);
  };

  const handleSignIn = async () => {
    if (!selectedProvider || !studentId.trim() || !password) return;
    setIsSubmitting(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      await connectIntegration(
        {
          provider: selectedProvider,
          username: studentId.trim(),
          password,
        },
        { signal: controller.signal },
      );
      clearTimeout(timeoutId);
      toast("Connected", "success");
      updateIntegration(selectedProvider, {
        connected: true,
        lastVerifiedAt: new Date().toISOString(),
      });
      closeSignInSheet();
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") {
        setError("Connection timed out. DLU may be unavailable — try again.");
      } else {
        setError(
          "That didn't work. Double-check your student ID and password and try again.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!selectedProvider) return;
    setIsSubmitting(true);
    try {
      await disconnectIntegration(selectedProvider);
      toast("Disconnected", "success");
      updateIntegration(selectedProvider, {
        connected: false,
        lastVerifiedAt: null,
      });
      closeConfirmSheet();
    } catch {
      toast("Failed to disconnect", "destructive");
    } finally {
      setIsSubmitting(false);
    }
  };

  const allConnected =
    integrations?.length === 2 && integrations.every((i) => i.connected);

  return (
    <>
      {/* Header */}
      <View
        className="border-b border-border/70 bg-background/80 px-6 py-4 flex-row items-center justify-start"
        style={{ backdropFilter: "blur(18px) saturate(1.4)" }}
      >
        <Pressable onPress={onBack} accessibilityLabel="Back" className="mr-3">
          <ChevronLeft size={24} className="text-foreground" />
        </Pressable>
        <Text className="text-xl font-bold tracking-tight">
          Connect DLU account
        </Text>
        <View className="w-8" />
      </View>

      {/* Provider list */}
      <View className="flex-1 min-h-0">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          contentContainerClassName="px-5"
        >
          {allConnected && (
            <View className="mt-5 mb-5 flex flex-row items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3">
              <View className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600">
                <Check size={14} className="text-emerald-600" strokeWidth={3} />
              </View>
              <Text className="text-[12.5px] font-medium text-emerald-700">
                Zenflow is watching both for you.
              </Text>
            </View>
          )}
          {!allConnected && (
            <Text className="mt-5 mb-5 text-[13.5px] leading-relaxed text-muted-foreground">
              Link an account and Zenflow keeps an eye on it for new assignments
              and timetable changes.
            </Text>
          )}
          <View className="overflow-hidden rounded-2xl border dark:border-gray-300 border-gray-700 bg-card">
            {(["LMS", "PORTAL"] as IntegrationProvider[]).map(
              (provider, index) => (
                <View
                  key={provider}
                  className={index > 0 ? "border-t border-border" : ""}
                >
                  <View className="flex flex-row items-center gap-3.5 px-4 py-7">
                    <ProviderIcon
                      provider={provider}
                      connected={isConnected(provider)}
                    />

                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-semibold">
                        {provider === "LMS" ? "DLU LMS" : "Student portal"}
                      </Text>

                      {isConnected(provider) ? (
                        <Text className="mt-0.5 text-[12.5px] font-medium text-emerald-600">
                          {formatLastVerified(
                            getProviderStatus(provider)?.lastVerifiedAt ?? null,
                          )}
                        </Text>
                      ) : (
                        <Muted className="mt-0.5 text-[12.5px]">
                          Not connected
                        </Muted>
                      )}
                    </View>

                    {isConnected(provider) ? (
                      <Pressable
                        onPress={() => openDisconnectConfirm(provider)}
                        className="shrink-0"
                        disabled={isSubmitting}
                      >
                        <Text className="text-[12.5px] font-semibold text-destructive">
                          Disconnect
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => openSignInSheet(provider)}
                        className="shrink-0 rounded-lg bg-primary px-3.5 py-1.5"
                        disabled={isSubmitting}
                      >
                        <Text className="text-[13px] font-semibold text-primary-foreground">
                          Connect
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ),
            )}
          </View>
          {!allConnected && (
            <Muted className="mt-3.5 text-[12px] leading-snug px-2">
              Your login is used only to check DLU on your behalf, and never
              shown to anyone.
            </Muted>
          )}
        </ScrollView>
      </View>

      {/* Overlay sheets */}
      <BottomSheet>
        {/* Sign-in Sheet */}
        <BottomSheetContent
          ref={signInSheet.ref}
          index={0}
          enablePanDownToClose={true}
        >
          <BottomSheetView className="" style={{ paddingBottom: 30 }}>
            <View className=" pb-3 pt-1">
              <Text className="text-xl font-bold tracking-tight">
                Sign in to your DLU{" "}
                {selectedProvider === "LMS" ? "LMS" : "Portal"}
              </Text>
            </View>
            {!error && (
              <Text className="mb-4 text-[13.5px] leading-relaxed text-muted-foreground">
                Same student ID and password you use on the DLU site.
              </Text>
            )}
            {error && (
              <View className="mb-4 flex flex-row items-start gap-2.5 rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-3">
                <View className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                  <AlertCircle
                    size={14}
                    strokeWidth={2.5}
                    className="text-destructive"
                  />
                </View>
                <Text className="text-[12.5px] leading-snug text-destructive/90">
                  {error}
                </Text>
              </View>
            )}
            <View className="mb-3">
              <Text className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">
                Student ID
              </Text>
              <Input
                value={studentId}
                onChangeText={setStudentId}
                placeholder="2112345"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSubmitting}
              />
            </View>
            <View className="mb-5">
              <Text className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">
                Password
              </Text>
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry={!showPassword}
                editable={!isSubmitting}
                className={cn(
                  error && "border-destructive ring-[3px] ring-destructive/15",
                )}
                aria-invalid={!!error}
                rightElement={
                  <Pressable
                    onPress={() => setShowPassword(!showPassword)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {showPassword ? (
                      <EyeOff
                        size={16}
                        strokeWidth={2}
                        className="text-muted-foreground"
                      />
                    ) : (
                      <Eye
                        size={16}
                        strokeWidth={2}
                        className="text-muted-foreground"
                      />
                    )}
                  </Pressable>
                }
              />
            </View>
            <Button
              className="w-full"
              disabled={isSubmitting}
              onPress={handleSignIn}
            >
              <Text className="font-semibold text-primary-foreground">
                {isSubmitting
                  ? "Connecting\u2026"
                  : error
                    ? "Try again"
                    : "Connect"}
              </Text>
            </Button>
          </BottomSheetView>
        </BottomSheetContent>

        {/* Disconnect Confirm Sheet */}
        <BottomSheetContent
          ref={confirmSheet.ref}
          index={1}
          enablePanDownToClose={true}
        >
          <BottomSheetView style={{ paddingBottom: 30 }}>
            <View className=" pb-3 pt-1">
              <Text className="text-xl font-bold tracking-tight">
                Disconnect the {selectedProvider === "LMS" ? "LMS" : "Portal"}?
              </Text>
            </View>
            <Text className="mt-1.5 mb-5 text-[13px] text-muted-foreground leading-snug">
              Zenflow will stop checking it for new assignments. You can
              reconnect any time.
            </Text>
            <View className="flex flex-row gap-2.5">
              <Button
                variant="outline"
                className="flex-1"
                onPress={closeConfirmSheet}
                disabled={isSubmitting}
              >
                <Text className="font-semibold text-foreground">Keep it</Text>
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onPress={handleDisconnect}
                disabled={isSubmitting}
              >
                <Text className="font-semibold text-white">Disconnect</Text>
              </Button>
            </View>
          </BottomSheetView>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
