import { listTags } from "@/api/tags";
import { Check, Plus, Tag, X } from "@/components/Icons";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { matchTags } from "@/lib/tag-match";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

const MAX_SUGGESTIONS = 6;

/**
 * Tag combobox — RN port of
 * `frontend/src/components/tasks/form/tag-field.tsx` (dropdown of existing
 * tags + "Create '#x'"). Same `string[]` of tag NAMES as the form value,
 * same "pending" (dashed chip) treatment for a name that doesn't exist yet.
 *
 * Unlike the web version this doesn't route through cmdk — see
 * `lib/tag-match.ts` for why (fixes `mockups/feedback.md` item 5's fuzzy-
 * match bug rather than porting it). The dropdown itself is a plain absolute
 * `View` (mirrors the mockup's `absolute inset-x-0 top-full` popover)
 * instead of a nested bottom sheet, since it needs to stay anchored right
 * under the input as the user types — a full sheet would be overkill here.
 */
export function TagAutocomplete({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [existing, setExisting] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    listTags()
      .then((tags) => setExisting(tags.map((t) => t.name)))
      .catch(() => setExisting([]));
  }, []);

  const trimmed = query.trim();

  const options = useMemo(() => {
    const selected = new Set(value.map((v) => v.toLowerCase()));
    const pool = existing.filter((name) => !selected.has(name.toLowerCase()));
    return matchTags(trimmed, pool).slice(0, MAX_SUGGESTIONS);
  }, [existing, value, trimmed]);

  const canCreate =
    !!trimmed &&
    !value.some((t) => t.toLowerCase() === trimmed.toLowerCase()) &&
    !existing.some((t) => t.toLowerCase() === trimmed.toLowerCase());

  const showDropdown =
    focused && !disabled && (options.length > 0 || canCreate);

  function add(name: string) {
    const clean = name.trim();
    if (!clean || value.some((t) => t.toLowerCase() === clean.toLowerCase()))
      return;
    onChange([...value, clean]);
    setQuery("");
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  return (
    <View className="gap-2">
      {value.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {value.map((tag) => {
            const isPending = !existing.includes(tag);
            return (
              <View
                key={tag}
                className={cn(
                  "flex-row items-center gap-1 rounded-full border py-1.5 pl-3 pr-1.5",
                  isPending
                    ? "border-dashed border-primary/50 bg-primary/10"
                    : "border-brand-orange/45 bg-brand-orange/15",
                )}
              >
                <Text
                  className={cn(
                    "text-[13px] font-medium",
                    isPending ? "text-primary" : "text-brand-orange",
                  )}
                >
                  #{tag}
                </Text>
                <Pressable
                  disabled={disabled}
                  onPress={() => remove(tag)}
                  accessibilityLabel={`Remove ${tag}`}
                  className="h-4 w-4 items-center justify-center rounded-full"
                >
                  <X
                    size={11}
                    className={isPending ? "text-primary" : "text-brand-orange"}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View className="relative">
        <View className="h-[46px] flex-row items-center gap-2 rounded-[13px] border border-input bg-card px-[13px]">
          <Tag size={16} className="shrink-0 text-muted-foreground" />
          <Input
            editable={!disabled}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            // Delay so a tap on a dropdown row still registers before it
            // unmounts on blur.
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Add a tag…"
            className="h-auto native:h-auto flex-1 border-0 bg-transparent px-0"
          />
        </View>

        {showDropdown && (
          <View className="absolute inset-x-0 top-[52px] z-20 overflow-hidden rounded-[13px] border border-border bg-popover shadow-lg">
            {options.map((name, i) => (
              <Pressable
                key={name}
                onPress={() => add(name)}
                className={cn(
                  "flex-row items-center gap-[9px] px-[13px] py-[11px]",
                  i > 0 && "border-t border-border",
                )}
              >
                <Tag size={15} className="shrink-0 text-muted-foreground" />
                <Text className="flex-1 text-sm text-foreground">#{name}</Text>
                <Check size={14} className="text-transparent" />
              </Pressable>
            ))}
            {canCreate && (
              <Pressable
                onPress={() => add(trimmed)}
                className={cn(
                  "flex-row items-center gap-[9px] px-[13px] py-[11px]",
                  options.length > 0 && "border-t border-border",
                )}
              >
                <Plus size={15} className="shrink-0 text-muted-foreground" />
                <Text className="text-sm font-semibold text-brand-orange">
                  Create "{trimmed}"
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <Text className="text-xs text-muted-foreground">
        Tags help our system learn your preferences and personalize your
        schedule in the future.
      </Text>
    </View>
  );
}
