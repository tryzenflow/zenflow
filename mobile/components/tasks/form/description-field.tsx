import {
  Bold,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Quote,
  Underline as UnderlineIcon,
  Upload,
} from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useRef, useState } from "react";
import {
  type NativeSyntheticEvent,
  Pressable,
  TextInput,
  type TextInputSelectionChangeEventData,
  View,
} from "react-native";

type Selection = { start: number; end: number };

/**
 * Description (note) editor — RN port of
 * `frontend/src/components/tasks/note-editor.tsx` / `common/editor/*`.
 *
 * The web editor is Tiptap/ProseMirror (DOM-only, no RN port — see
 * `docs/react-native-migration.md`'s "Must be replaced" inventory, which
 * pegs a real WYSIWYG RN richtext editor, `@10play/tentap-editor`, as later
 * work). This is deliberately the simpler Phase-1-style building block the
 * migration doc calls out first ("Native `TextInput` multiline (Phase 1)")
 * — a plain multiline `TextInput` — but with the full toolbar bolted on as
 * a **floating selection bubble** (per the checklist) that wraps the
 * current selection in the same HTML tags Tiptap would produce
 * (`<strong>`, `<em>`, …), so the stored `note` string stays renderable by
 * the web `NoteEditor` even though this editor shows the raw tags rather
 * than a live WYSIWYG preview. That's a known, intentional simplification —
 * see the RN migration issue #20 write-up for the full trade-off; true
 * WYSIWYG parity is follow-up work.
 *
 * "Upload file" is present in the toolbar for the full tool-set requirement
 * but is a stub here (no `expo-image-picker`/`expo-document-picker` wiring
 * yet) — tapping it surfaces a toast explaining that instead of silently
 * doing nothing.
 */
export function DescriptionField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const { toast } = useToast();
  const hasSelection = selection.end > selection.start && !disabled;

  function setCursor(pos: number) {
    setSelection({ start: pos, end: pos });
    // `setNativeProps` nudges the native selection after a programmatic
    // value change — RN doesn't otherwise move the caret for us.
    requestAnimationFrame(() =>
      inputRef.current?.setNativeProps({
        selection: { start: pos, end: pos },
      }),
    );
  }

  function applyWrap(openTag: string, closeTag: string) {
    const { start, end } = selection;
    if (end <= start) return;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    onChange(`${before}${openTag}${selected}${closeTag}${after}`);
    setCursor(start + openTag.length + selected.length + closeTag.length);
  }

  function applyList(ordered: boolean) {
    const { start, end } = selection;
    if (end <= start) return;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const items = selected
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => `<li>${line}</li>`)
      .join("");
    const wrapped = ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
    onChange(`${before}${wrapped}${after}`);
    setCursor(before.length + wrapped.length);
  }

  function insertLink() {
    const { start, end } = selection;
    if (end <= start) return;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const tag = `<a href="${selected}">${selected}</a>`;
    onChange(`${before}${tag}${after}`);
    setCursor(before.length + tag.length);
  }

  return (
    <View className="gap-1.5">
      <View className="relative">
        <TextInput
          ref={inputRef}
          editable={!disabled}
          multiline
          value={value}
          onChangeText={onChange}
          onSelectionChange={(
            e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
          ) => setSelection(e.nativeEvent.selection)}
          placeholder="Add details, links, or context…"
          placeholderTextColor="rgb(121 112 101)"
          className="min-h-[70px] rounded-[13px] border border-input bg-card px-3.5 py-3 text-[15px] leading-[21px] text-foreground"
          style={{ fontFamily: "Geist" }}
        />

        {hasSelection && (
          <View
            pointerEvents="box-none"
            className="absolute -top-[46px] left-1/2 z-10 flex-row items-center gap-0.5 rounded-full bg-[#221d17] p-1 shadow-lg"
            style={{ transform: [{ translateX: -132 }] }}
          >
            <ToolbarButton
              icon={Bold}
              label="Bold"
              onPress={() => applyWrap("<strong>", "</strong>")}
            />
            <ToolbarButton
              icon={Italic}
              label="Italic"
              onPress={() => applyWrap("<em>", "</em>")}
            />
            <ToolbarButton
              icon={UnderlineIcon}
              label="Underline"
              onPress={() => applyWrap("<u>", "</u>")}
            />
            <ToolbarButton
              icon={Highlighter}
              label="Highlight"
              onPress={() => applyWrap("<mark>", "</mark>")}
            />
            <ToolbarButton
              icon={Quote}
              label="Blockquote"
              onPress={() => applyWrap("<blockquote>", "</blockquote>")}
            />
            <View className="mx-1 h-4 w-px bg-white/20" />
            <ToolbarButton icon={Link2} label="Link" onPress={insertLink} />
            <ToolbarButton
              icon={Upload}
              label="Upload file"
              onPress={() =>
                toast(
                  "File uploads aren't available in the mobile description editor yet",
                  "info",
                )
              }
            />
            <View className="mx-1 h-4 w-px bg-white/20" />
            <ToolbarButton
              icon={List}
              label="Bulleted list"
              onPress={() => applyList(false)}
            />
            <ToolbarButton
              icon={ListOrdered}
              label="Numbered list"
              onPress={() => applyList(true)}
            />
          </View>
        )}
      </View>
      <Text className="text-[12.5px] leading-snug text-muted-foreground">
        Select text to format it — the toolbar pops up as a floating bubble.
      </Text>
    </View>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      className="h-[30px] w-[30px] items-center justify-center rounded-full active:bg-white/20"
    >
      <Icon size={14} className="text-white" />
    </Pressable>
  );
}
