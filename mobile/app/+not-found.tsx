import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { Text } from "@/components/ui";
import { useUserStore } from "@/hooks/use-user-store";
import { routeForSession } from "@/lib/onboarding";
import { Link, type Href, Redirect, Stack, usePathname } from "expo-router";
import { View } from "react-native";

export default function NotFoundScreen() {
  useLanguage();
  const pathname = usePathname();
  console.log({ pathname });
  const user = useUserStore((s) => s.user);
  const loading = useUserStore((s) => s.loading);

  // The route guards in `_layout.tsx` unmount the groups the session can't
  // use, so a launch URL of "/" (which matches `(app)/index`) is "not found"
  // for a signed-out or not-yet-onboarded user. Send them to their own group.
  if (loading) return null;
  const target = routeForSession(user, "");
  if (target) return <Redirect href={target as Href} />;
  // Onboarded and landed on the bare launch URL: that's just home.
  if (user && pathname === "/") return <Redirect href={"/(app)" as Href} />;

  return (
    <>
      <Stack.Screen options={{ title: t("Oops!") }} />
      <View>
        <Text>{t("We can't find that screen.")}</Text>

        <Link href="/">
          <Text>{t("Go to home screen!")}</Text>
        </Link>
      </View>
    </>
  );
}
