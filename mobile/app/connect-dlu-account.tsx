import { ConnectDluAccountScreen } from "@/components/settings/connect-dlu-account-screen";
import { useRouter } from "expo-router";

export default function ConnectDluAccountRoute() {
  const router = useRouter();
  return <ConnectDluAccountScreen onBack={() => router.back()} />;
}
