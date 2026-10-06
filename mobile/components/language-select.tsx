import { ChevronDown } from "@/components/Icons";
import {
  OptionSheet,
  type OptionSheetHandle,
} from "@/components/settings/option-sheet";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { LANGUAGES, setSignedOutLanguage } from "@/lib/preferences";
import { useRef } from "react";
import { Pressable } from "react-native";

/**
 * Compact language pill (flag + name) that opens the shared option sheet. Works
 * signed out: it only switches the UI and caches the pick; login then applies
 * it to the account.
 */
export function LanguageSelect() {
  const language = useLanguage();
  const sheet = useRef<OptionSheetHandle>(null);
  const current = LANGUAGES.find((l) => l.value === language);

  return (
    <>
      <Pressable
        onPress={() => sheet.current?.open()}
        accessibilityRole="button"
        accessibilityLabel={t("Language")}
        className="h-9 flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 active:opacity-70"
      >
        <Text className="text-[15px]">{current?.flag}</Text>
        <Text className="text-[13px] font-semibold">{current?.label}</Text>
        <ChevronDown size={14} className="text-muted-foreground" />
      </Pressable>
      <OptionSheet
        ref={sheet}
        title={t("Language")}
        options={LANGUAGES}
        value={language}
        onSelect={(next) => void setSignedOutLanguage(next)}
      />
    </>
  );
}
