import {
  connectIntegration,
  disconnectIntegration,
  syncIntegration,
  updateIntegration as updateIntegrationRequest,
} from "@/api/integrations";
import {
  AlertCircle,
  CreditCard,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  MoreHorizontal,
  RefreshCw,
  Unlink,
} from "@/components/Icons";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetInput,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { cn } from "@/lib/utils";
import type { IntegrationProvider, IntegrationStatus } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { useState } from "react";
import { Pressable, View } from "react-native";

const PROVIDERS: IntegrationProvider[] = ["LMS", "PORTAL"];

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  LMS: "LMS",
  PORTAL: "Student portal",
};

/** Connect/update give up after this long — DLU is often slow or down. */
const REQUEST_TIMEOUT_MS = 15000;

type SheetMode = "connect" | "update";

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
      className={cn(
        "size-[38px] shrink-0 items-center justify-center rounded-xl",
        connected ? "bg-emerald-500/15" : "bg-muted",
      )}
    >
      <Icon
        size={18}
        className={connected ? "text-emerald-600" : "text-muted-foreground"}
      />
      {connected && (
        <View className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-emerald-500" />
      )}
    </View>
  );
}

/** Compact "5m ago" / "3h ago" / "2d ago". */
function shortAgo(iso: string): string {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(iso)) / 60000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** One short subtitle per row — the last sync is the only thing worth showing. */
function rowSubtitle(
  status: IntegrationStatus | undefined,
  syncing: boolean,
): { text: string; tone: "muted" | "ok" | "error" } {
  if (!status?.connected) return { text: "Not connected", tone: "muted" };
  if (syncing || status.lastSyncStatus === "PROCESSING")
    return { text: "Syncing…", tone: "muted" };
  if (status.lastSyncStatus === "FAILED")
    return { text: "Last sync failed", tone: "error" };
  if (status.lastSyncedAt)
    return { text: `Synced ${shortAgo(status.lastSyncedAt)}`, tone: "ok" };
  return { text: "Connected", tone: "ok" };
}

function errorMessageFor(error: unknown): string {
  if (isAxiosError(error)) {
    if (error.code === "ERR_CANCELED")
      return "Connection timed out. DLU may be unavailable — try again.";
    if (error.response?.status === 503)
      return "Couldn't reach DLU right now — try again in a bit.";
  }
  return "That didn't work. Double-check your student ID and password and try again.";
}

/**
 * Settings section for LMS / student-portal accounts: connect, update
 * credentials, sync and disconnect inline.
 */
export function DluAccountsSection() {
  const { toast } = useToast();
  const { integrations, updateIntegration } = useIntegrationStore();
  const [selectedProvider, setSelectedProvider] =
    useState<IntegrationProvider | null>(null);
  const [mode, setMode] = useState<SheetMode>("connect");
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [syncing, setSyncing] = useState<IntegrationProvider | null>(null);

  const manageSheet = useBottomSheet();
  const signInSheet = useBottomSheet();
  const confirmSheet = useBottomSheet();

  const statusOf = (provider: IntegrationProvider) =>
    integrations.find((i) => i.provider === provider);

  const openSignInSheet = (provider: IntegrationProvider, next: SheetMode) => {
    setSelectedProvider(provider);
    setMode(next);
    setError(null);
    setStudentId("");
    setPassword("");
    setShowPassword(false);
    signInSheet.open();
  };

  const openManageSheet = (provider: IntegrationProvider) => {
    setSelectedProvider(provider);
    manageSheet.open();
  };

  /** Let the manage sheet finish dismissing before the next sheet opens. */
  const afterManageSheet = (next: () => void) => {
    manageSheet.close();
    setTimeout(next, 180);
  };

  const closeSignInSheet = () => {
    signInSheet.close();
    setStudentId("");
    setPassword("");
    setError(null);
    setShowPassword(false);
  };

  const handleSubmit = async () => {
    if (!selectedProvider) return;
    const username = studentId.trim();
    setIsSubmitting(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const status =
        mode === "connect"
          ? await connectIntegration(
              { provider: selectedProvider, username, password },
              { signal: controller.signal },
            )
          : await updateIntegrationRequest(
              selectedProvider,
              {
                ...(username && { username }),
                ...(password && { password }),
              },
              { signal: controller.signal },
            );
      updateIntegration(selectedProvider, status);
      toast(
        mode === "connect" ? "Connected" : "Credentials updated",
        "success",
      );
      closeSignInSheet();
    } catch (err) {
      setError(errorMessageFor(err));
    } finally {
      clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  };

  const handleSync = async (provider: IntegrationProvider) => {
    setSyncing(provider);
    try {
      const status = await syncIntegration(provider);
      updateIntegration(provider, status);
      toast(`${PROVIDER_LABEL[provider]} synced`, "success");
    } catch (err) {
      toast(
        isAxiosError(err) && err.response?.status === 503
          ? "Couldn't reach DLU right now."
          : "Sync failed",
        "destructive",
      );
    } finally {
      setSyncing(null);
    }
  };

  const handleDisconnect = async () => {
    if (!selectedProvider) return;
    setIsSubmitting(true);
    try {
      const status = await disconnectIntegration(selectedProvider);
      updateIntegration(selectedProvider, status);
      toast("Disconnected", "success");
      confirmSheet.close();
    } catch {
      toast("Failed to disconnect", "destructive");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    !isSubmitting &&
    (mode === "connect"
      ? !!studentId.trim() && !!password
      : !!studentId.trim() || !!password);
  const selectedLabel = selectedProvider
    ? PROVIDER_LABEL[selectedProvider]
    : "";

  return (
    <>
      <SettingsSectionLabel>DLU accounts</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        {PROVIDERS.map((provider, index) => {
          const status = statusOf(provider);
          const connected = !!status?.connected;
          const subtitle = rowSubtitle(status, syncing === provider);
          return (
            <View
              key={provider}
              className={cn(
                "px-4 py-3.5",
                index > 0 && "border-t border-border",
              )}
            >
              <View className="flex-row items-center gap-[13px]">
                <ProviderIcon provider={provider} connected={connected} />
                <View className="min-w-0 flex-1">
                  <Text className="text-[15px] font-semibold" numberOfLines={1}>
                    {PROVIDER_LABEL[provider]}
                  </Text>
                  <Text
                    numberOfLines={1}
                    className={cn(
                      "mt-0.5 text-[13px]",
                      subtitle.tone === "ok" && "text-emerald-600",
                      subtitle.tone === "error" && "text-destructive",
                      subtitle.tone === "muted" && "text-muted-foreground",
                    )}
                  >
                    {subtitle.text}
                  </Text>
                </View>
                {connected ? (
                  <Pressable
                    onPress={() => openManageSheet(provider)}
                    hitSlop={8}
                    accessibilityLabel={`Manage ${PROVIDER_LABEL[provider]}`}
                    className="size-9 items-center justify-center rounded-lg active:bg-muted"
                  >
                    <MoreHorizontal
                      size={18}
                      className="text-muted-foreground"
                    />
                  </Pressable>
                ) : (
                  <Button
                    size="sm"
                    className="rounded-lg"
                    disabled={isSubmitting}
                    onPress={() => openSignInSheet(provider, "connect")}
                  >
                    <Text className="text-[13px] font-semibold text-primary-foreground">
                      Connect
                    </Text>
                  </Button>
                )}
              </View>

              {/* Second line, aligned with the text (icon 38 + gap 13) */}
              {connected && (
                <View className="mt-2.5 flex-row pl-[51px]">
                  <Button
                    size="sm"
                    className="flex-row items-center gap-1.5 rounded-lg"
                    disabled={syncing !== null}
                    onPress={() => handleSync(provider)}
                    accessibilityLabel={`Sync ${PROVIDER_LABEL[provider]} now`}
                  >
                    <RefreshCw size={14} className="text-primary-foreground" />
                    <Text className="text-[13px] font-semibold text-primary-foreground">
                      {syncing === provider ? "Syncing…" : "Sync now"}
                    </Text>
                  </Button>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <BottomSheet>
        {/* Manage sheet — the rarely-used actions, kept off the row */}
        <BottomSheetContent ref={manageSheet.ref}>
          <BottomSheetView hadHeader={false} className="gap-1 pt-2">
            <Text className="mb-1 px-1 text-[15px] font-bold tracking-tight">
              {selectedLabel}
            </Text>
            <Pressable
              onPress={() =>
                afterManageSheet(() => {
                  if (selectedProvider)
                    openSignInSheet(selectedProvider, "update");
                })
              }
              className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70"
            >
              <KeyRound size={18} className="text-foreground" />
              <Text className="flex-1 text-[14px] font-medium">
                Update login
              </Text>
            </Pressable>
            <Pressable
              onPress={() => afterManageSheet(() => confirmSheet.open())}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70"
            >
              <Unlink size={18} className="text-destructive" />
              <Text className="flex-1 text-[14px] font-medium text-destructive">
                Disconnect
              </Text>
            </Pressable>
          </BottomSheetView>
        </BottomSheetContent>

        {/* Sign-in / update-credentials sheet */}
        <BottomSheetContent ref={signInSheet.ref}>
          <BottomSheetView style={{ paddingBottom: 30 }}>
            <View className="pb-3 pt-1">
              <Text className="text-xl font-bold tracking-tight">
                {mode === "connect"
                  ? `Sign in to your ${selectedLabel}`
                  : `Update your ${selectedLabel} login`}
              </Text>
            </View>
            {error ? (
              <View className="mb-4 flex-row items-start gap-2.5 rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-3">
                <View className="mt-0.5 size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15">
                  <AlertCircle
                    size={14}
                    strokeWidth={2.5}
                    className="text-destructive"
                  />
                </View>
                <Text className="flex-1 text-[12.5px] leading-snug text-destructive/90">
                  {error}
                </Text>
              </View>
            ) : (
              <Text className="mb-4 text-[13.5px] leading-relaxed text-muted-foreground">
                {mode === "connect"
                  ? "Your DLU student ID and password — only used to check DLU for you."
                  : "Leave a field blank to keep what's saved."}
              </Text>
            )}
            <View className="mb-3">
              <Text className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">
                Student ID
              </Text>
              <BottomSheetInput
                value={studentId}
                onChangeText={setStudentId}
                placeholder={
                  mode === "connect" ? "2112345" : "Leave blank to keep"
                }
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSubmitting}
              />
            </View>
            <View className="mb-5">
              <Text className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">
                Password
              </Text>
              <BottomSheetInput
                value={password}
                onChangeText={setPassword}
                placeholder={
                  mode === "connect" ? "••••••••" : "Leave blank to keep"
                }
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
              disabled={!canSubmit}
              onPress={handleSubmit}
            >
              <Text className="font-semibold text-primary-foreground">
                {isSubmitting
                  ? mode === "connect"
                    ? "Connecting…"
                    : "Saving…"
                  : error
                    ? "Try again"
                    : mode === "connect"
                      ? "Connect"
                      : "Update login"}
              </Text>
            </Button>
          </BottomSheetView>
        </BottomSheetContent>

        {/* Disconnect confirm sheet */}
        <BottomSheetContent ref={confirmSheet.ref}>
          <BottomSheetView style={{ paddingBottom: 30 }}>
            <View className="pb-3 pt-1">
              <Text className="text-xl font-bold tracking-tight">
                Disconnect the {selectedLabel}?
              </Text>
            </View>
            <Text className="mb-5 mt-1.5 text-[13px] leading-snug text-muted-foreground">
              Zenflow will stop checking it for new assignments. You can
              reconnect any time.
            </Text>
            <View className="flex-row gap-2.5">
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => confirmSheet.close()}
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
