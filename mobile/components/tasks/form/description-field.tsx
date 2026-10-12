import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Maximize2 } from "@/components/Icons";
import { NoteSkeleton } from "@/components/tasks/note-skeleton";
import { Text } from "@/components/ui/text";
import { getBaseURL } from "@/lib/api-client";
import { resolveNoteFileUrls } from "@/lib/file-link";
import { noteSnippet } from "@/lib/note-html";
import { cn } from "@/lib/utils";
import { Suspense, lazy, useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// The editor (tentap + tiptap + WebView) is the heaviest module in the form.
// It is only needed once the modal opens, so it is loaded then instead of
// being evaluated with the rest of the app at startup.
const DescriptionFieldEditor = lazy(() =>
  import("./description-editor").then((m) => ({
    default: m.DescriptionFieldEditor,
  })),
);

/**
 * Shown while the editor chunk loads. Same header as the editor (title +
 * Done) so only the body is a skeleton and the modal can still be closed.
 */
function EditorFallback({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <Text className="text-[19px] font-bold tracking-tight">
          {t("Description")}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityLabel={t("Done")}
          className="h-9 flex-row items-center rounded-full bg-primary px-4"
        >
          <Text className="text-[14px] font-semibold text-primary-foreground">
            {t("Done")}
          </Text>
        </Pressable>
      </View>
      <View className="px-5 pt-5">
        <NoteSkeleton />
      </View>
    </View>
  );
}

export function DescriptionField({
  initialValue: storedValue,
  onChange,
  onUpload,
  disabled,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  onUpload?: (ids: string[]) => void;
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
        <Suspense fallback={<EditorFallback onClose={() => setOpen(false)} />}>
          <DescriptionFieldEditor
            initialValue={value}
            onChange={(html) => {
              setValue(html);
              onChange(html);
            }}
            onClose={() => setOpen(false)}
            onUpload={onUpload}
            disabled={disabled}
          />
        </Suspense>
      </Modal>
    </>
  );
}
