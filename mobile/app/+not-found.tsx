import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { Text } from "@/components/ui";
import { Link, Stack, usePathname } from "expo-router";
import { View } from "react-native";

export default function NotFoundScreen() {
  useLanguage();
  const pathname = usePathname();
  console.log({ pathname });

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
