import { Toaster } from "@/components/ui/sonner";
import { useCallback, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { getData, patchData } from "./api";
import { useUserStore } from "./hooks/use-user-store";
import HomePage from "./pages/home";
import LoginPage from "./pages/login";
import { PrefSetupPage } from "./pages/pref-setup";
import { User } from "./types/user";
import AnalyticsPage from "./pages/analytics";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { LoaderCircleIcon } from "lucide-react";
import NotFoundPage from "./pages/not-found";

function App() {
  const user = useUserStore((state) => state.user);
  const loading = useUserStore((state) => state.loading);
  const setUser = useUserStore((state) => state.setUser);
  const setLoading = useUserStore((state) => state.setLoading);

  useEffect(() => {
    setLoading(true);
    getData<{ data: User }>("/auth/me")
      .then(({ data }) => setUser(data))
      .catch()
      .finally(() => setLoading(false));
  }, []);

  const updateTimezone = useCallback(
    async (timezone: string) => {
      setLoading(true);
      try {
        patchData("/users/update/basic-info", { timezone });
        setUser(user ? { ...user, timezone } : null);
        toast.success("Timezone updated successfully");
      } catch {
        toast.error("Failed to update timezone");
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    if (!user) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone !== user.timezone)
      if (user.timezone === "Europe/Paris") {
        updateTimezone(timezone).catch(() =>
          toast.error("Failed to update timezone"),
        );
      } else {
        toast.info(`Do you want to change your timezone to ${timezone}?`, {
          action: (
            <Button
              disabled={!!loading}
              variant="outline"
              onClick={() => updateTimezone(timezone)}
            >
              {loading ? (
                <LoaderCircleIcon className="size-4" />
              ) : (
                <span>Update</span>
              )}
            </Button>
          ),
        });
      }
  }, [user, loading, updateTimezone]);

  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/prefs" element={<PrefSetupPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
