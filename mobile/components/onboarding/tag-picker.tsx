import { Check } from "@/components/Icons";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { addCustomTag, tagOptions, toggleTag } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type React from "react";
import { Pressable, View } from "react-native";

/** Chip grid of suggested + custom tags with an "add your own" input. */
export function TagPicker({
  selected,
  onChange,
  InputComponent = Input,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  /** Sheets pass `BottomSheetInput` so the keyboard lifts the sheet. */
  InputComponent?: React.ComponentType<React.ComponentProps<typeof Input>>;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    if (!draft.trim()) return;
    onChange(addCustomTag(selected, draft));
    setDraft("");
  }

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {tagOptions(selected).map((name) => {
          const on = selected.some(
            (s) => s.toLowerCase() === name.toLowerCase(),
          );
          return (
            <Pressable
              key={name}
              onPress={() => onChange(toggleTag(selected, name))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              className={cn(
                "flex-row items-center gap-1.5 rounded-full border px-3.5 py-2",
                on ? "border-primary bg-primary/15" : "border-border bg-card",
              )}
            >
              {on && <Check size={14} className="text-primary" />}
              <Text className="text-[14px] font-medium">{name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View className="mt-4 flex-row items-center gap-2">
        <InputComponent
          className="flex-1"
          value={draft}
          onChangeText={setDraft}
          placeholder="Add your own tag…"
          maxLength={50}
          returnKeyType="done"
          onSubmitEditing={add}
        />
        <Pressable
          onPress={add}
          disabled={!draft.trim()}
          className={cn(
            "rounded-lg bg-primary px-4 py-3",
            !draft.trim() && "opacity-50",
          )}
        >
          <Text className="text-[14px] font-semibold text-primary-foreground">
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
