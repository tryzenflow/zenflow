import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { createTagsBulk, listTags } from "@/api/tags";
import { ChevronRight, List } from "@/components/Icons";
import { TagPicker } from "@/components/onboarding/tag-picker";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetInput,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { mergeTagNames, newTagsForBulk } from "@/lib/onboarding";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

/** Settings "Tags" row: shows the count and opens a picker to add more. */
export function TagsRow() {
  useLanguage();
  const { toast } = useToast();
  const sheet = useBottomSheet();
  const [saved, setSaved] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listTags()
      .then((t) => setSaved(t.map((x) => x.name)))
      .catch(() => {});
  }, []);

  async function save() {
    const names = newTagsForBulk(selected, saved);
    if (names.length === 0) return sheet.close();
    setSaving(true);
    try {
      const tags = await createTagsBulk(names);
      // Merge, don't replace: the response may omit tags we didn't send.
      setSaved((prev) =>
        mergeTagNames(
          prev,
          tags.map((t) => t.name),
        ),
      );
      sheet.close();
    } catch {
      toast(t("Couldn't save tags. Try again."), "destructive");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsSectionLabel>{t("Tags")}</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <Pressable
          onPress={() => {
            setSelected(saved);
            sheet.open();
          }}
          className="flex-row items-center gap-[13px] px-4 py-3.5"
        >
          <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <List size={18} className="text-foreground" />
          </View>
          <Text className="flex-1 text-[15px] font-semibold">{t("Tags")}</Text>
          <Text className="text-[13px] text-muted-foreground">
            {saved.length}
          </Text>
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </View>
      <BottomSheet>
        <BottomSheetContent ref={sheet.ref}>
          <BottomSheetView style={{ paddingBottom: 30 }}>
            <Text className="pb-3 pt-1 text-xl font-bold tracking-tight">
              {t("Tags")}
            </Text>
            <TagPicker
              selected={selected}
              onChange={setSelected}
              InputComponent={BottomSheetInput}
            />
            <Button
              className="mt-5 rounded-xl"
              disabled={saving}
              onPress={save}
            >
              <Text className="font-semibold text-primary-foreground">
                {t("Save")}
              </Text>
            </Button>
          </BottomSheetView>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
