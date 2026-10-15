import { GlassButton } from "@/components/ui/glass-button";
import { Input } from "@/components/ui/input";
import { SessionAgenda } from "@/components/calendar/session-agenda";
import { useLanguage } from "@/hooks/use-language";
import { ChevronLeft, Search } from "@/components/Icons";
import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** How long to wait after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Full-screen search over the user's sessions. Opens with the field focused and
 * lists matches in the shared agenda. Mount it to open, and unmount it through
 * `onClose` to go back.
 */
export function SessionSearchView({ onClose }: { onClose: () => void }) {
  useLanguage();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <View
      testID="session-search.view"
      className="bg-background"
      style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}
    >
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-2">
        <GlassButton
          icon={ChevronLeft}
              iconSize={24}
          accessibilityLabel={t("Back")}
          onPress={onClose}
          haptic={false}
          testID="session-search.back"
        />
        <Input
          className="flex-1"
          value={query}
          onChangeText={setQuery}
          placeholder={t("Search")}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          testID="session-search.input"
          rightElement={<Search size={18} className="text-muted-foreground" />}
        />
      </View>
      <SessionAgenda
        term={term}
        pending={query.trim() !== term}
        onOpenSession={onClose}
      />
    </View>
  );
}
