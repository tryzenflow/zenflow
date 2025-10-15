import { Toaster } from "@/components/ui/sonner";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/login";
import { PrefSetupPage } from "./pages/pref-setup";
import { useEffect } from "react";
import { getData } from "./api";
import { useUserStore } from "./hooks/use-user-store";
import { User } from "./types/user";
import HomePage from "./pages/home";

function App() {
  const setUser = useUserStore((state) => state.setUser);

  useEffect(() => {
    getData<{ data: User }>("/auth/me").then(({ data }) => setUser(data));
  }, []);

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
