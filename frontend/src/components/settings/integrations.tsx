import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { isAxiosError } from "axios";
import { Loader2, Plug, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { errorToast } from "@/lib/toast";
import { toast } from "sonner";
import {
  connectIntegration,
  disconnectIntegration,
  listIntegrations,
  syncIntegration,
  updateIntegration,
} from "@/api/integrations";
import type {
  IntegrationProvider,
  IntegrationStatus,
} from "@zenflow/shared";

const PROVIDERS: { id: IntegrationProvider; label: string; blurb: string }[] = [
  {
    id: "LMS",
    label: "Moodle (LMS)",
    blurb: "Pulls your assignments and quiz deadlines onto the calendar.",
  },
  {
    id: "PORTAL",
    label: "Student portal",
    blurb: "Pulls your class timetable and exam schedule onto the calendar.",
  },
];

function messageFor(error: unknown): string {
  if (isAxiosError(error)) {
    if (error.response?.status === 400)
      return "Those credentials were rejected. Double-check and try again.";
    if (error.response?.status === 503)
      return "Couldn't reach the university right now. Try again in a bit.";
    return error.response?.data?.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

function ProviderCard({
  provider,
  status,
  onChanged,
}: {
  provider: (typeof PROVIDERS)[number];
  status: IntegrationStatus | undefined;
  onChanged: () => void;
}) {
  const connected = !!status?.connected;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(
    null,
  );

  const submit = async () => {
    setBusy("connect");
    try {
      if (connected) {
        await updateIntegration(provider.id, { username, password });
        toast.success(`${provider.label} credentials updated`);
      } else {
        await connectIntegration({
          provider: provider.id,
          username,
          password,
        });
        toast.success(`${provider.label} connected`);
      }
      setUsername("");
      setPassword("");
      onChanged();
    } catch (error) {
      errorToast(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      await syncIntegration(provider.id);
      toast.success(`${provider.label} synced`);
      onChanged();
    } catch (error) {
      errorToast(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await disconnectIntegration(provider.id);
      toast.success(`${provider.label} disconnected`);
      onChanged();
    } catch (error) {
      errorToast(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{provider.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {provider.blurb}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            connected
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {connected && status && (
        <dl className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
          <dt>Verified</dt>
          <dd className="text-right text-foreground">
            {status.lastVerifiedAt
              ? formatDistanceToNow(new Date(status.lastVerifiedAt), {
                  addSuffix: true,
                })
              : "—"}
          </dd>
          <dt>Last sync</dt>
          <dd className="text-right text-foreground">
            {status.lastSyncedAt
              ? formatDistanceToNow(new Date(status.lastSyncedAt), {
                  addSuffix: true,
                })
              : "never"}
            {status.lastSyncStatus ? ` (${status.lastSyncStatus.toLowerCase()})` : ""}
          </dd>
        </dl>
      )}

      <div className="mt-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              placeholder={connected ? "Leave blank to keep" : "Student ID"}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              placeholder={connected ? "Leave blank to keep" : "Password"}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={submit}
            disabled={
              busy !== null ||
              (!connected && (!username || !password)) ||
              (connected && !username && !password)
            }
          >
            {busy === "connect" && <Loader2 className="size-3.5 animate-spin" />}
            {connected ? "Update credentials" : "Connect"}
          </Button>
          {connected && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={sync}
                disabled={busy !== null}
              >
                {busy === "sync" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Sync now
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={disconnect}
                disabled={busy !== null}
                className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Disconnect
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function IntegrationsPanel() {
  const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    listIntegrations()
      .then(setStatuses)
      .catch(() => setError(true));
  };

  useEffect(load, []);

  if (error) {
    return (
      <div className="rounded-md border border-border p-4 text-center text-xs text-muted-foreground">
        Couldn't load your integrations.{" "}
        <button className="underline" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  if (!statuses) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Plug className="size-3.5" />
        Connect your university accounts to auto-populate deadlines and classes.
        Credentials are encrypted and never shown again.
      </p>
      {PROVIDERS.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          status={statuses.find((s) => s.provider === p.id)}
          onChanged={load}
        />
      ))}
    </div>
  );
}
