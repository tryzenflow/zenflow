import { Toaster } from "@/components/ui/sonner";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import HomePage from "./pages/home";
import LoginPage from "./pages/login";

import NotFoundPage from "./pages/not-found";

/**
 * There is no onboarding step: a fresh signup lands in the app directly
 * (timezone is captured at OTP signup via the `x-timezone` header — see
 * `api/auth.ts` — with no separate onboarding-complete gate). Mirrors
 * `mobile/app/_layout.tsx`'s `AuthGate`.
 */
function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
