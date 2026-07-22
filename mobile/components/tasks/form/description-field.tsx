import {
  Bold,
  Check,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Quote,
  Underline as UnderlineIcon,
  Upload,
  X,
} from "@/components/Icons";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import {
  BlockquoteBridge,
  BoldBridge,
  BulletListBridge,
  CoreBridge,
  HighlightBridge,
  ItalicBridge,
  LinkBridge,
  OrderedListBridge,
  PlaceholderBridge,
  RichText,
  UnderlineBridge,
  useBridgeState,
  useEditorBridge,
} from "@10play/tentap-editor";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

// Amber-200-ish — same "Warm Sunrise" family as the web editor's default
// (unconfigured) Tiptap `Highlight` mark, which renders browser-default
// yellow. `HighlightBridge.toggleHighlight` requires an explicit color
// (unlike web's mark-with-no-args toggle), so this is that fixed color.
const HIGHLIGHT_COLOR = "#fde68a";

const EDITOR_EXTENSIONS = [
  CoreBridge,
  BoldBridge,
  ItalicBridge,
  UnderlineBridge,
  HighlightBridge,
  BlockquoteBridge,
  LinkBridge,
  BulletListBridge,
  OrderedListBridge,
  PlaceholderBridge,
];

/**
 * Description (note) editor — RN port of
 * `frontend/src/components/tasks/note-editor.tsx` / `common/editor/*`, on
 * `@10play/tentap-editor` (Tiptap + ProseMirror running in a WebView with a
 * native RN bridge — the real WYSIWYG follow-up flagged in the RN migration
 * issue #20 write-up and `docs/react-native-migration.md`'s Phase 2 richtext
 * entry, replacing this file's earlier plain-`TextInput` + raw-HTML-tag
 * placeholder).
 *
 * Tool set matches the web toolbar (`common/editor/toolbar.tsx`): Bold,
 * Italic, Underline, Highlight, Blockquote marks; Link insert; Bulleted /
 * Numbered lists. "Upload file" stays a stub toast — real upload wiring is
 * out of scope here too.
 *
 * KNOWN GAP vs. web: the toolbar is a fixed pill bar docked above the
 * editor (shown while focused), not a bubble anchored to the exact text
 * selection like the old `TextInput` hack (or web's Tiptap bubble menu).
 * `tentap-editor`'s bridge doesn't expose WebView-internal selection screen
 * coordinates to native, so there's nothing to anchor a true per-selection
 * bubble to — a fixed contextual toolbar is the idiomatic pattern its own
 * docs use (see the package's Basic example). Marks/lists can be toggled
 * with or without a text selection (typing then continues in that style),
 * which is actually more correct WYSIWYG behavior than the old
 * selection-required hack.
 *
 * External contract unchanged: `value`/`onChange` stay a plain HTML string
 * (`create-task-sheet.tsx`/`edit-task-sheet.tsx` → `task-sheet-fields.tsx`
 * pass this through a React Hook Form `Controller`, untouched by this
 * rewrite) — kept web-renderable by the same `NoteEditor`, since `note`
 * round-trips through the same `@zenflow/shared` API field on both apps.
 * `useEditorBridge` only exposes content via an async `getHTML()` (the
 * WebView bridge is message-passing, not synchronous), so `onChange` here
 * awaits that and forwards the resolved HTML string outward; incoming
 * `value` changes that didn't originate from our own `onChange` (e.g.
 * `EditTaskSheet`'s `form.reset()` after `getTaskDetails()` resolves) are
 * detected against a "last emitted" ref and pushed into the editor via
 * `editor.setContent(...)`.
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
  const { isDarkColorScheme } = useColorScheme();
  const { toast } = useToast();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const lastEmitted = useRef(value);

  const editor = useEditorBridge({
    bridgeExtensions: EDITOR_EXTENSIONS,
    initialContent: value || "",
    editable: !disabled,
    dynamicHeight: true,
    theme: {
      webview: {
        backgroundColor: isDarkColorScheme
          ? "rgb(29 26 23)"
          : "rgb(255 255 255)",
      },
    },
    onChange: () => {
      editor.getHTML().then((html) => {
        lastEmitted.current = html;
        onChange(html);
      });
    },
  });

  const state = useBridgeState(editor);

  // Resync from the outside (e.g. `EditTaskSheet`'s `form.reset()` once
  // `getTaskDetails()` resolves) without fighting the editor's own
  // in-progress edits — only push `setContent` when `value` changed for a
  // reason other than our own last `onChange` emission.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.setContent(value || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    editor.setEditable(!disabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Best-effort — the WebView may not have finished loading yet on the very
  // first mount, in which case this silently no-ops (console warning only,
  // see `sendMessage` in the library); the field still works, it just shows
  // no placeholder until the next content sync.
  useEffect(() => {
    editor.setPlaceholder("Add details, links, or context…");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openLink() {
    setLinkDraft(state.activeLink ?? "");
    setLinkOpen(true);
  }

  function confirmLink() {
    editor.setLink(linkDraft.trim() || null);
    setLinkOpen(false);
  }

  return (
    <View className="gap-1.5">
      <View className="flex-row flex-wrap items-center gap-0.5 self-start rounded-full bg-[#221d17] p-1 shadow-lg">
        <ToolbarButton
          icon={Bold}
          label="Bold"
          active={!!state.isBoldActive}
          disabled={disabled}
          onPress={() => editor.toggleBold()}
        />
        <ToolbarButton
          icon={Italic}
          label="Italic"
          active={!!state.isItalicActive}
          disabled={disabled}
          onPress={() => editor.toggleItalic()}
        />
        <ToolbarButton
          icon={UnderlineIcon}
          label="Underline"
          active={!!state.isUnderlineActive}
          disabled={disabled}
          onPress={() => editor.toggleUnderline()}
        />
        <ToolbarButton
          icon={Highlighter}
          label="Highlight"
          active={!!state.activeHighlight}
          disabled={disabled}
          onPress={() => editor.toggleHighlight(HIGHLIGHT_COLOR)}
        />
        <ToolbarButton
          icon={Quote}
          label="Blockquote"
          active={!!state.isBlockquoteActive}
          disabled={disabled}
          onPress={() => editor.toggleBlockquote()}
        />
        <View className="mx-1 h-4 w-px bg-white/20" />
        <ToolbarButton
          icon={Link2}
          label="Link"
          active={!!state.isLinkActive || linkOpen}
          disabled={disabled}
          onPress={openLink}
        />
        <ToolbarButton
          icon={Upload}
          label="Upload file"
          disabled={disabled}
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
          active={!!state.isBulletListActive}
          disabled={disabled}
          onPress={() => editor.toggleBulletList()}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Numbered list"
          active={!!state.isOrderedListActive}
          disabled={disabled}
          onPress={() => editor.toggleOrderedList()}
        />
      </View>

      {linkOpen && (
        <View className="flex-row items-center gap-1.5">
          <Input
            autoFocus
            editable={!disabled}
            value={linkDraft}
            onChangeText={setLinkDraft}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="h-10 flex-1 rounded-full border border-input bg-card px-3.5 text-[13px] text-foreground"
          />
          <Pressable
            onPress={confirmLink}
            accessibilityLabel="Confirm link"
            className="h-10 w-10 items-center justify-center rounded-full bg-primary"
          >
            <Check size={16} className="text-primary-foreground" />
          </Pressable>
          <Pressable
            onPress={() => setLinkOpen(false)}
            accessibilityLabel="Cancel link"
            className="h-10 w-10 items-center justify-center rounded-full bg-muted"
          >
            <X size={16} className="text-muted-foreground" />
          </Pressable>
        </View>
      )}

      <View className="min-h-[110px] overflow-hidden rounded-[13px] border border-input bg-card">
        <RichText editor={editor} />
      </View>

      <Text className="text-[12.5px] leading-snug text-muted-foreground">
        Tap the toolbar to format — Bold, Italic, Underline, Highlight,
        Blockquote, Link, Bulleted and Numbered lists.
      </Text>
    </View>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onPress,
  active,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      className={cn(
        "h-[30px] w-[30px] items-center justify-center rounded-full active:bg-white/20",
        active && "bg-white/25",
        disabled && "opacity-40",
      )}
    >
      <Icon size={14} className="text-white" />
    </Pressable>
  );
}
