import { LoginForm } from "@/components/auth/login-form";
import { useUserStore } from "../hooks/use-user-store";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function LoginPage() {
  const user = useUserStore((state) => state.user);
  const loading = useUserStore((state) => state.loading);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (user) navigate(searchParams.get("callback") ?? "/");
  }, [user, loading, searchParams]);

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  );
}
