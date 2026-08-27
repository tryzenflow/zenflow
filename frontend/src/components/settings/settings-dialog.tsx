import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserStore } from "@/hooks/use-user-store";
import { logout } from "@/api/auth";
import { UserPreferencesPanel } from "@/components/settings/preferences";

/** Log the user out locally even if the network call fails, then route to login. */
async function performLogout(navigate: (to: string) => void) {
  try {
    await logout();
  } catch {
    // Sign the user out locally even if the request fails.
  } finally {
    useUserStore.getState().setUser(null);
    navigate("/login");
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabId = "insights" | "account";

const TABS: { id: TabId; label: string; icon: typeof BarChart3 }[] = [
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "account", label: "Account", icon: UserRound },
];

/**
 * Tabbed preferences dialog: Insights · Account. There is no "Work" tab
 * anymore — `workStart`/`workEnd`/`workDays` were dropped from `User` with no
 * replacement (education-pivot migration; see `@zenflow/shared`'s `user.ts`)
 * and the scheduler no longer constrains placement to a configured working
 * window. Timezone is likewise fixed at OTP signup and isn't user-editable,
 * so it's shown read-only under Account instead of in an editable form.
 * Insights hosts the 7×24 preference heatmap (mounted only when its tab is
 * active → fetch-on-open).
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const navigate = useNavigate();
  const { user } = useUserStore();

  const [tab, setTab] = useState<TabId>("insights");

  useEffect(() => {
    if (open) setTab("insights");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Review the learning behaviour Zenflow uses to schedule your
            sessions, and manage your account.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          className="flex min-h-0 flex-1 mt-4 px-6 flex-col gap-0"
        >
          <TabsList className="w-full">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.id} value={t.id}>
                  <Icon className="size-3.5" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto py-6">
            {/* Insights — preference heatmap (fetch-on-open) */}
            <TabsContent value="insights" className="mt-0 space-y-6">
              <Section
                title="Your preference map"
                description="When Zenflow schedules your sessions on the hot zones highlighted in green."
              >
                {tab === "insights" && <UserPreferencesPanel />}
              </Section>
            </TabsContent>

            {/* Account — profile + sign out */}
            <TabsContent value="account" className="mt-0 space-y-6">
              <Section
                title="Account"
                description="You're signed in to Zenflow."
              >
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-muted/40 p-3.5">
                    <p className="text-sm font-semibold">{user?.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {user?.email}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Timezone {user?.timezone}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => performLogout(navigate)}
                  >
                    <LogOut className="h-3.5 w-3.5" /> Log out
                  </Button>
                </div>
              </Section>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
