import { User } from "@/types/user";
import { api } from "./base";

export async function requestOtp(email: string) {
  const { data } = await api.post("/auth/otp/request", { email });
  return data;
}

export async function verifyOtp(email: string, otp: string) {
  const { data } = await api.post(
    "/auth/otp/verify",
    { email, otp },
    {
      headers: {
        "x-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    },
  );
  return data;
}

export async function logout() {
  await api.post("/auth/logout");
}

export async function me(): Promise<User | null> {
  const { data } = await api.get("/auth/me");
  return data.data;
}
