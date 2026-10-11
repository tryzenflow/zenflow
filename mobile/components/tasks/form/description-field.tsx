import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Maximize2 } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { getBaseURL } from "@/lib/api-client";
import { resolveNoteFileUrls } from "@/lib/file-link";
import { noteSnippet } from "@/lib/note-html";
import { cn } from "@/lib/utils";
import { Suspense, lazy, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";

// The editor (tentap + tiptap + WebView) is the heaviest module in the form.
// It is only needed once the modal opens, so it is loaded then instead of
// being evaluated with the rest of the app at startup.
const DescriptionFieldEditor = lazy(() =>
  import("./description-editor").then((m) => ({
    default: m.DescriptionFieldEditor,
  })),
);

export function DescriptionField({
  initialValue: storedValue,
  onChange,
  disabled,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  useLanguage();
  // The API sends file refs origin-relative; the editor WebView needs absolute.
  const initialValue = resolveNoteFileUrls(storedValue, getBaseURL());
  const [value, setValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  // A genuinely new `initialValue` from the parent (its fetch resolved after
  // mount) replaces what the card shows; echoes of our own edits are no-ops.
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);
  const snippet = noteSnippet(value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("Description")}
        className={cn(
          "min-h-[96px] flex-row items-start gap-3 rounded-[13px] border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07] px-3.5 py-3 active:bg-muted/40",
          disabled && "opacity-50",
        )}
      >
        <Text
          numberOfLines={4}
          className={cn(
            "flex-1 text-[15px] leading-[21px]",
            !snippet && "text-muted-foreground",
          )}
        >
          {snippet || t("Add notes…")}
        </Text>
        <Maximize2 size={16} className="mt-0.5 text-muted-foreground" />
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setOpen(false)}
      >
        <Suspense
          fallback={
            <View className="flex-1 items-center justify-center bg-background">
              <ActivityIndicator />
            </View>
          }
        >
          <DescriptionFieldEditor
            initialValue={value}
            onChange={(html) => {
              setValue(html);
              onChange(html);
            }}
            onClose={() => setOpen(false)}
            disabled={disabled}
          />
        </Suspense>
      </Modal>
    </>
  );
}
