import { useLanguage } from "@/hooks/use-language";
import { Stack } from "expo-router";

export default function OnboardingLayout() {
  useLanguage();
  return <Stack screenOptions={{ headerShown: false }} />;
}
