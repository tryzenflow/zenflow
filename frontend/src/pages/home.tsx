import { useNavigate } from "react-router-dom";
import { useUserStore } from "../hooks/use-user-store";
import { useEffect } from "react";

export default function HomePage() {
  const user = useUserStore((state) => state.user);
  const navigate = useNavigate();
  useEffect(() => {
    if (!user) {
      navigate("/login?callback=/");
      return;
    }
    if (user._count.categories === 0 || user._count.constraints === 0) {
      navigate("/prefs?callback=/");
      return;
    }
  }, [user]);
  if (!user) return null;
  return <span>Welcome back, {user.name}</span>;
}
