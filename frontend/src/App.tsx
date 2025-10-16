import { Toaster } from "@/components/ui/sonner";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/login";
import { PrefSetupPage } from "./pages/pref-setup";
import { useEffect } from "react";
import { getData, patchData } from "./api";
import { useUserStore } from "./hooks/use-user-store";
import { User } from "./types/user";
import HomePage from "./pages/home";

function App() {
  const user = useUserStore((state) => state.user);
  const setUser = useUserStore((state) => state.setUser);
  const setLoading = useUserStore((state) => state.setLoading);

  useEffect(() => {
    setLoading(true);
    getData<{ data: User }>("/auth/me")
      .then(({ data }) => setUser(data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone !== user.timezone)
      patchData("/users/update/basic-info", { timezone });
  }, [user]);

  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/prefs" element={<PrefSetupPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
