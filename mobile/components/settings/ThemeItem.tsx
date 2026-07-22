import type { ReactElement } from "react";
import { Pressable, View } from "react-native";

import { H4 } from "@/components/ui/typography";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetOpenTrigger,
  BottomSheetView,
} from "@/components/primitives/bottomSheet/bottom-sheet.native";
import { Text } from "@/components/ui//text";
import { Moon, Palette, Smartphone, Check, Sun } from "@/components/Icons";

import ListItem from "@/components/ui/list-item";
import { useCallback, useMemo, useState } from "react";
import { useBottomSheetModal } from "@gorhom/bottom-sheet";

import { useColorScheme } from "@/lib/useColorScheme";
import { useLocalStorage } from "@/hooks";
type ItemData = {
  title: string;
  subtitle: string;
  value: "light" | "dark" | "system";
  icon: ReactElement;
};

type ItemProps = {
  item: ItemData;
  onPress: () => void;
  selected: boolean;
};

function ThemeItem({ item, onPress, selected }: ItemProps) {
  return (
    <Pressable className="py-4" onPress={onPress}>
      <View className="flex bg-pink flex-row justify-between">
        <View className="pr-4 pt-1">{item.icon}</View>
        <View className="flex-1">
          <H4>{item.title}</H4>
          <Text className="text-sm text-muted-foreground">{item.subtitle}</Text>
        </View>
        <View>{selected && <Check className="text-accent-foreground" />}</View>
      </View>
    </Pressable>
  );
}

export const ThemeSettingItem = () => {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [selectedTheme, setSelectedTheme] = useState<"light" | "dark" | "system">(colorScheme);
  const { dismiss } = useBottomSheetModal();
  const { setItem } = useLocalStorage();

  const themes: ItemData[] = useMemo(
    () => [
      {
        title: "Device settings",
        subtitle: "Default to your device's appearance",
        value: "system",
        icon: <Smartphone className="text-foreground" />,
      },
      {
        title: "Dark mode",
        subtitle: "Always use Dark mode",
        value: "dark",
        icon: <Moon className="text-foreground" />,
      },
      {
        title: "Light mode",
        subtitle: "Always use Light mode",
        value: "light",
        icon: <Sun className="text-foreground" />,
      },
    ],
    []
  );

  const onSelect = useCallback(
    async (value: "light" | "dark" | "system") => {
      setColorScheme(value);
      await setItem("theme", value);
      setSelectedTheme(value);
      dismiss();
    },
    [dismiss, setColorScheme, setItem]
  );
  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild>
        <ListItem
          itemLeft={(props) => <Palette {...props} />} // props adds size and color attributes
          label="Theme"
        />
      </BottomSheetOpenTrigger>
      <BottomSheetContent>
        <BottomSheetHeader className="bg-background">
          <Text className="text-foreground text-xl font-bold  pb-1">
            Select Theme
          </Text>
        </BottomSheetHeader>
        <BottomSheetView className="gap-5 pt-6 bg-background">
          {themes.map((theme) => (
            <ThemeItem
              key={theme.title}
              item={theme}
              onPress={() => onSelect(theme.value)}
              selected={theme.value === selectedTheme}
            />
          ))}
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
};
