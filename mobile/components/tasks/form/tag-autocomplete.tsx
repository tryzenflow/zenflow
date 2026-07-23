import { listTags } from "@/api/tags";
import { Check, Plus, Tag, X } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFlatList,
  BottomSheetHeader,
  BottomSheetOpenTrigger,
  BottomSheetTextInput,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { matchTags } from "@/lib/tag-match";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import type { ListRenderItemInfo } from "react-native";
import { Pressable, View } from "react-native";

type Row =
  | { kind: "tag"; name: string; selected: boolean }
  | { kind: "create"; name: string }
  | { kind: "empty" };

/**
 * Tag picker — RN port of
 * `frontend/src/components/tasks/form/tag-field.tsx` (dropdown of existing
 * tags + "Create '#x'"). Same `string[]` of tag NAMES as the form value,
 * same "pending" (dashed chip) treatment for a name that doesn't exist yet.
 *
 * Unlike the web version this doesn't route through cmdk — see
 * `lib/tag-match.ts` for why (fixes `mockups/feedback.md` item 5's fuzzy-
 * match bug rather than porting it).
 *
 * v2: was originally an absolute-positioned `View` popover anchored under
 * the input (mirroring the web mockup's `absolute inset-x-0 top-full`
 * dropdown), opening on focus. That's not a mobile-friendly pattern — no
 * click-outside-to-dismiss, awkward with the on-screen keyboard, and it sat
 * inside the same `BottomSheetScrollView` as every other field, focus-
 * trapping and layout-thrashing against the surrounding sheet. Replaced with
 * the nested-bottom-sheet picker every other field-with-a-list in this app
 * already uses (`InlineTimeField`, `components/ui/combobox.tsx`) — a tap
 * opens a second sheet stacked on the create/edit sheet (a supported
 * `@gorhom/bottom-sheet` pattern under the one shared
 * `BottomSheetModalProvider` in `app/_layout.tsx`), with its own search
 * input and full-height list instead of a cramped 6-row popover.
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
  const bottomSheet = useBottomSheet();

  useEffect(() => {
    listTags()
      .then((tags) => setExisting(tags.map((t) => t.name)))
      .catch(() => setExisting([]));
  }, []);

  const trimmed = query.trim();
  const selectedSet = useMemo(
    () => new Set(value.map((v) => v.toLowerCase())),
    [value],
  );

  // Selected tags now STAY in the visible pool (with a checkmark treatment,
  // rendered below) instead of being filtered out the instant they're
  // picked — filtering them out gave zero confirming feedback that the tap
  // registered, reading as "the row just vanished."
  const options = useMemo(
    () => matchTags(trimmed, existing),
    [existing, trimmed],
  );

  const canCreate =
    !!trimmed &&
    !value.some((t) => t.toLowerCase() === trimmed.toLowerCase()) &&
    !existing.some((t) => t.toLowerCase() === trimmed.toLowerCase());

  function add(name: string) {
    const clean = name.trim();
    if (!clean || value.some((t) => t.toLowerCase() === clean.toLowerCase()))
      return;
    onChange([...value, clean]);
    // Left open so the user can add several tags in one visit — dismissed
    // via the sheet header's close button, not on every pick.
    setQuery("");
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  }

  /** Toggle a row's selection — the same tap adds when unselected, removes
   * when already selected (mirrors the checkmark row already added to
   * `InlineTimeField`/`InlineDateField`). */
  function toggle(name: string, isSelected: boolean) {
    if (isSelected) remove(name);
    else add(name);
  }

  const rows: Row[] = [
    ...options.map(
      (name): Row => ({
        kind: "tag",
        name,
        selected: selectedSet.has(name.toLowerCase()),
      }),
    ),
    ...(canCreate ? [{ kind: "create", name: trimmed } as Row] : []),
  ];
  if (rows.length === 0) rows.push({ kind: "empty" });

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

      <BottomSheet>
        <BottomSheetOpenTrigger asChild disabled={disabled}>
          <Pressable
            className={cn(
              "h-[46px] flex-row items-center gap-2 rounded-[13px] border border-input bg-card px-[13px]",
              disabled && "opacity-50",
            )}
          >
            <Tag size={16} className="shrink-0 text-muted-foreground" />
            <Text className="flex-1 text-base text-muted-foreground">
              Add a tag…
            </Text>
            <Plus size={16} className="shrink-0 text-muted-foreground" />
          </Pressable>
        </BottomSheetOpenTrigger>

        <BottomSheetContent
          ref={bottomSheet.ref}
          onDismiss={() => setQuery("")}
          // Fixed height, not the default `enableDynamicSizing={true}` — that
          // re-measures and re-snaps the sheet's height on every row-count
          // change (`rows` reshapes on literally every keystroke as
          // `matchTags`/`canCreate` re-run), which read as "the sheet
          // suddenly collapsed" while typing. Same fix
          // `change-duration-sheet.tsx` already applied for the identical
          // symptom. A shorter, fixed snap point (vs. full height) also
          // keeps the dark backdrop visible above the sheet for tap-to-
          // dismiss, matching the "don't want a full-height sheet" ask.
          enableDynamicSizing={false}
          snapPoints={["70%"]}
          // Overrides the shared `<BottomSheetContent>` default of
          // `keyboardBehavior="fillParent"` (see that file's own doc comment
          // for why that's the default) — `"fillParent"` expands ANY sheet
          // to fill all available height above the keyboard, which is wrong
          // for a fixed-`snapPoints` sheet like this one: it grew to full
          // height with no dark backdrop visible at the top, instead of just
          // nudging this sheet's existing 70% snap point up above the
          // keyboard. `"interactive"` (gorhom's own upstream default) is the
          // mode that translates a sheet upward by the keyboard height while
          // preserving its snap point/size — the correct behavior for a
          // fixed-height sheet with a search input.
          keyboardBehavior="interactive"
        >
          <BottomSheetHeader>
            <Text className="text-lg font-bold text-foreground">Add tags</Text>
          </BottomSheetHeader>

          <View className="px-4 pb-3 pt-3.5">
            <BottomSheetTextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search or create a tag…"
              returnKeyType="done"
              onSubmitEditing={() => {
                if (canCreate) add(trimmed);
              }}
              className="h-12 text-base"
            />
          </View>

          <BottomSheetFlatList
            data={rows}
            keyExtractor={(item, i) => {
              const row = item as Row;
              return row.kind === "empty" ? "empty" : `${row.kind}:${row.name}`;
            }}
            className="px-4"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }: ListRenderItemInfo<unknown>) => {
              const row = item as Row;
              if (row.kind === "empty") {
                return (
                  <View className="items-center px-3 py-6">
                    <Text className="text-sm text-muted-foreground">
                      {trimmed
                        ? "No matching tags."
                        : "No tags yet — type to create one."}
                    </Text>
                  </View>
                );
              }
              if (row.kind === "create") {
                return (
                  <Pressable
                    onPress={() => add(row.name)}
                    className="mb-2 flex-row items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3.5"
                  >
                    <Plus
                      size={16}
                      className="shrink-0 text-muted-foreground"
                    />
                    <Text className="flex-1 text-[15px] font-semibold text-brand-orange">
                      Create "{row.name}"
                    </Text>
                  </Pressable>
                );
              }
              return (
                <Pressable
                  onPress={() => toggle(row.name, row.selected)}
                  className={cn(
                    "mb-2 flex-row items-center gap-2.5 rounded-xl border px-4 py-3.5",
                    row.selected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card",
                  )}
                >
                  <Tag
                    size={16}
                    className={cn(
                      "shrink-0",
                      row.selected ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <Text
                    className={cn(
                      "flex-1 text-[15px]",
                      row.selected
                        ? "font-semibold text-foreground"
                        : "text-foreground",
                    )}
                  >
                    #{row.name}
                  </Text>
                  {row.selected && (
                    <View className="h-5 w-5 items-center justify-center rounded-full bg-primary">
                      <Check size={12} className="text-primary-foreground" />
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        </BottomSheetContent>
      </BottomSheet>

      <Text className="text-xs text-muted-foreground">
        Tags help our system learn your preferences and personalize your
        schedule in the future.
      </Text>
    </View>
  );
}
