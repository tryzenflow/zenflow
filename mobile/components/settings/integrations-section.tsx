import {
  connectIntegration,
  disconnectIntegration,
  listIntegrations,
  syncIntegration,
  updateIntegration,
} from "@/api/integrations";
import { ChevronRight, Link2, RefreshCw } from "@/components/Icons";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetOpenTrigger,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { IntegrationProvider, IntegrationStatus } from "@zenflow/shared";
import { formatDistanceToNow } from "date-fns";
import { isAxiosError } from "axios";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

const PROVIDERS: { id: IntegrationProvider; label: string; blurb: string }[] = [
  {
    id: "LMS",
    label: "Moodle (LMS)",
    blurb: "Assignments and quiz deadlines",
  },
  {
    id: "PORTAL",
    label: "Student portal",
    blurb: "Class timetable and exams",
  },
];

function messageFor(error: unknown): string {
  if (isAxiosError(error)) {
    if (error.response?.status === 400)
      return "Those credentials were rejected.";
    if (error.response?.status === 503)
      return "Couldn't reach the university right now.";
    return error.response?.data?.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

function ProviderRow({
  provider,
  status,
  onChanged,
}: {
  provider: (typeof PROVIDERS)[number];
  status: IntegrationStatus | undefined;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const sheet = useBottomSheet();
  const connected = !!status?.connected;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "sync" | "disconnect" | null>(null);

  const submit = async () => {
    setBusy("save");
    try {
      if (connected) {
        await updateIntegration(provider.id, { username, password });
        toast("Credentials updated", "success");
      } else {
        await connectIntegration({
          provider: provider.id,
          username,
          password,
        });
        toast(`${provider.label} connected`, "success");
      }
      setUsername("");
      setPassword("");
      onChanged();
      sheet.close();
    } catch (error) {
      toast(messageFor(error), "destructive");
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      await syncIntegration(provider.id);
      toast(`${provider.label} synced`, "success");
      onChanged();
    } catch (error) {
      toast(messageFor(error), "destructive");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await disconnectIntegration(provider.id);
      toast(`${provider.label} disconnected`, "success");
      onChanged();
      sheet.close();
    } catch (error) {
      toast(messageFor(error), "destructive");
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild>
        <Pressable
          onPress={() => {
            setUsername("");
            setPassword("");
          }}
          className="flex-row items-center gap-[13px] bg-card px-4 py-3.5"
        >
          <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <Link2 size={18} className="text-foreground" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold">{provider.label}</Text>
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              {connected ? "Connected" : provider.blurb}
            </Text>
          </View>
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={sheet.ref}>
        <BottomSheetView className="px-0" hadHeader={false}>
          <View className="px-5">
            <Text className="text-[19px] font-bold tracking-tight">
              {provider.label}
            </Text>
            <Text className="mt-[3px] text-[13px] text-muted-foreground">
              {connected
                ? "Update or disconnect this account."
                : "Sign in to sync your school data. Credentials are encrypted and never shown again."}
            </Text>
          </View>

          {connected && status && (
            <View className="mt-3 flex-row gap-4 px-5">
              <Text className="text-[12px] text-muted-foreground">
                Last sync:{" "}
                {status.lastSyncedAt
                  ? formatDistanceToNow(new Date(status.lastSyncedAt), {
                      addSuffix: true,
                    })
                  : "never"}
                {status.lastSyncStatus
                  ? ` (${status.lastSyncStatus.toLowerCase()})`
                  : ""}
              </Text>
            </View>
          )}

          <View className="mt-4 gap-[14px] px-5">
            <View>
              <Text className="mb-2 text-[14px] font-semibold">Username</Text>
              <Input
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                placeholder={connected ? "Leave blank to keep" : "Student ID"}
              />
            </View>
            <View>
              <Text className="mb-2 text-[14px] font-semibold">Password</Text>
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder={connected ? "Leave blank to keep" : "Password"}
              />
            </View>
          </View>

          <View className="gap-2.5 px-5 pt-4">
            <Button
              className="w-full"
              disabled={
                busy !== null ||
                (!connected && (!username || !password)) ||
                (connected && !username && !password)
              }
              onPress={submit}
            >
              <Text className="font-semibold text-primary-foreground">
                {busy === "save"
                  ? "Saving…"
                  : connected
                    ? "Update credentials"
                    : "Connect"}
              </Text>
            </Button>
            {connected && (
              <>
                <Button
                  className="w-full flex-row items-center gap-2"
                  variant="outline"
                  disabled={busy !== null}
                  onPress={sync}
                >
                  <RefreshCw size={15} className="text-foreground" />
                  <Text className="font-semibold text-foreground">
                    {busy === "sync" ? "Syncing…" : "Sync now"}
                  </Text>
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy !== null}
                  onPress={disconnect}
                >
                  <Text className="font-semibold text-destructive">
                    {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                  </Text>
                </Button>
              </>
            )}
          </View>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
}

/** Settings section for the DLU LMS / student-portal ingestion accounts. */
export function IntegrationsSection() {
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);

  const load = useCallback(() => {
    listIntegrations()
      .then(setStatuses)
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <SettingsSectionLabel>Integrations</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        {PROVIDERS.map((p, i) => (
          <View
            key={p.id}
            className={cn(i > 0 && "border-t border-border")}
          >
            <ProviderRow
              provider={p}
              status={statuses.find((s) => s.provider === p.id)}
              onChanged={load}
            />
          </View>
        ))}
      </View>
    </>
  );
}
