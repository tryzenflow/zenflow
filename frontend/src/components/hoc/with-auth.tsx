import { getData } from "@/api";
import { useUserStore } from "@/hooks/use-user-store";
import { User } from "@/types/user";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function WithAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading, setLoading, setUser } = useUserStore();

  useEffect(() => {
    if (!user && !loading) {
      setLoading(true);
      getData<{ data: User }>("/auth/me")
        .then((data) => {
          setLoading(false);
          setUser(data.data);
        })
        .catch(() => {
          navigate(`/login?callback=${location.pathname}`);
        });
    }
  }, [user, loading, location.pathname]);

  if (loading) return null;

  return <>{children}</>;
}
