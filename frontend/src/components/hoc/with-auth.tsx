import { me } from "@/api/auth";
import { useUserStore } from "@/hooks/use-user-store";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Gate authenticated routes. Redirects to /login when unauthenticated. There
 * is no onboarding step — a fresh signup lands in the app directly (see
 * `App.tsx`).
 */
export function WithAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading, setLoading, setUser } = useUserStore();

  useEffect(() => {
    if (!user && !loading) {
      setLoading(true);
      me()
        .then((data) => {
          setUser(data);
        })
        .catch(() => {
          navigate(`/login?callback=${location.pathname}`);
        })
        .finally(() => {
          // Always clear the flag — otherwise a failed pre-login `me()` leaves
          // `loading` stuck `true`, and after login `WithAuth` renders null
          // (blank page) because of the `if (loading) return null` guard.
          setLoading(false);
        });
    }
  }, [user, loading, location.pathname]);

  // Render the protected children only once we have an authenticated user.
  // Until `me()` resolves (or while it's in flight) we render nothing — this is
  // what keeps an unauthenticated visit to `/` from mounting the calendar and
  // firing protected requests (`/sessions`, …) that 403 and spray "Forbidden
  // resource" toasts before the redirect to /login lands. The effect above
  // either sets the user or navigates away.
  if (loading || !user) return null;

  return <>{children}</>;
}
