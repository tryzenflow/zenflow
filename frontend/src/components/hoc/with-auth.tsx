import { me } from "@/api/auth";
import { useUserStore } from "@/hooks/use-user-store";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Gate authenticated routes. Redirects to /login when unauthenticated, and to
 * /onboarding until the user has completed onboarding.
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

  useEffect(() => {
    if (
      user &&
      !user.onboardingComplete &&
      location.pathname !== "/onboarding"
    ) {
      navigate("/onboarding");
    }
  }, [user, location.pathname]);

  if (loading) return null;

  return <>{children}</>;
}
