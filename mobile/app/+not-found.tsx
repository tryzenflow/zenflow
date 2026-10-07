import { Button, Text } from "@/components/ui";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Stack, useRouter } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function NotFoundScreen() {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        className="flex-1 items-center justify-center gap-2 bg-background px-8"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <Text
          accessibilityRole="header"
          className="text-center text-title font-bold tracking-tight text-foreground"
        >
          {t("That page isn't here")}
        </Text>
        <Text className="mb-4 text-center text-base text-muted-foreground">
          {t("The link may be out of date.")}
        </Text>
        <Button
          size="lg"
          onPress={() => router.replace("/")}
          accessibilityLabel={t("Back to calendar")}
        >
          <Text>{t("Back to calendar")}</Text>
        </Button>
      </View>
    </>
  );
}
