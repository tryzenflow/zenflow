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
import { Textarea } from "@/components/ui/textarea";
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
import { Platform, Pressable, View } from "react-native";

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
 *
 * WEB GAP (deliberate): `react-native-webview` ships **no real web
 * implementation** — `node_modules/react-native-webview/src/WebView.tsx`
 * (the file Metro's platform-extension resolution falls back to for
 * `platform=web`, since the package has `.ios`/`.android`/`.macos`/
 * `.windows` variants but no `.web`) is a static stub whose own comment
 * says it's "to render something for unsupported platforms, like for
 * example Expo SDK 'web' platform" — confirmed by grepping the actual
 * Metro web bundle for its literal text. So on `pnpm --filter mobile
 * dev:web` (this repo's only available dev target — see CLAUDE.md), the
 * WYSIWYG `RichText`/`useEditorBridge` machinery below never mounts a real
 * WebView, never loads `editorHtml`'s ProseMirror document, and never runs
 * the ResizeObserver-driven `dynamicHeight` height-reporting this file
 * depends on — any layout instability reported against the web target
 * can't be that document's CSS misbehaving (there's no document to
 * misbehave). `DescriptionField` below is a thin `Platform.OS` switch so
 * web dev gets an honest, bounded plain-text fallback (`DescriptionFieldWeb`)
 * instead of either the confusing dummy stub or an unbounded layout —
 * native (the real target platform) still gets the full editor via
 * `DescriptionFieldEditor`, unaffected by this gate.
 */
export function DescriptionField(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (Platform.OS === "web") {
    return <DescriptionFieldWeb {...props} />;
  }
  return <DescriptionFieldEditor {...props} />;
}

/**
 * Web-dev fallback — plain multiline text bound to the same HTML-string
 * `value`/`onChange` contract as the real editor (round-trips as-is, tags
 * and all; this is a dev-time convenience for exercising create/edit
 * end-to-end on the only locally-runnable target, not a second implementation
 * of the editor). No toolbar, no WebView, no unbounded growth risk — see the
 * WEB GAP note above for why this exists instead of trying to run the real
 * editor here.
 */
function DescriptionFieldWeb({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-1.5">
      <Textarea
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        placeholder="Add details, links, or context…"
        numberOfLines={5}
        className="max-h-[220px] min-h-[110px] text-sm"
      />
      <Text className="text-[12.5px] leading-snug text-muted-foreground">
        Rich text formatting (bold, links, lists, …) isn&apos;t available in the
        web dev preview — `react-native-webview` has no web implementation, so
        this is a plain-text fallback. The full toolbar editor runs on
        iOS/Android.
      </Text>
    </View>
  );
}

function DescriptionFieldEditor({
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

  // The bundled editor HTML ships no padding and no explicit font-size/color
  // on `.ProseMirror` — `theme.webview.backgroundColor` above only colors the
  // WebView's own background, not the document inside it. Inject a small
  // stylesheet (replacing the same `tag` keeps this idempotent) to match
  // `frontend/src/hooks/use-editor.ts`'s content-area classes
  // (`text-sm px-3 py-2`) and to force the text color to flip with the OS
  // color scheme, since nothing else does.
  //
  // `padding` is applied to `.ProseMirror` only, not `body` too — the two
  // previously both got `padding: 8px 12px`, and since `.ProseMirror` is a
  // descendant of `body` (not a replacement for it), that doubled the visual
  // inset on every edge. `body` only needs the matching background color so
  // there's no color seam around the (now singly-padded) content area.
  //
  // `max-height`/`overflow-y: auto` on `.ProseMirror` is a deliberate cap,
  // not part of the original design: the bundled editor HTML's base
  // stylesheet (`simpleWebEditor/index.html`) sets `.ProseMirror { min-height:
  // 100%; overflow: visible }` unconditionally, including in `dynamicHeight`
  // mode where the containing block's own height is `unset` (auto/content-
  // sized) — a circular percentage-height relationship. Spec-compliant engines
  // resolve `min-height: 100%` against an indefinite containing block as 0
  // (CSS2.1 §10.5), but WebView engines vary by OS/OEM version, and this
  // library's own `dynamicHeight` mechanism (a ResizeObserver reporting
  // `.ProseMirror`'s measured height back to native, which then resizes the
  // WebView's native container to match) would amplify any non-zero
  // resolution every tick. Capping `.ProseMirror`'s own rendered height here
  // makes the *measured* value bounded regardless of how a given engine
  // resolves the percentage, so the reported `dynamicHeight` can never run
  // away — content beyond the cap scrolls inside the editor's own document
  // instead (the WebView's own outer scroll stays disabled, per `RichText`'s
  // hardcoded `scrollEnabled={false}`, so `BottomSheetScrollView` remains the
  // single scroll owner up to this cap).
  function injectContentStyles() {
    const bg = isDarkColorScheme ? "rgb(29 26 23)" : "rgb(255 255 255)";
    const fg = isDarkColorScheme ? "rgb(250 250 249)" : "rgb(28 25 23)";
    editor.injectCSS(
      `body { background-color: ${bg}; } .ProseMirror { background-color: ${bg}; color: ${fg}; font-size: 14px; padding: 8px 12px; line-height: 1.5; max-height: 320px; overflow-y: auto; }`,
      "description-field-theme",
    );
  }

  useEffect(() => {
    injectContentStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkColorScheme]);

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

      {/* `max-h` is a second, outer safety net alongside the injected
          `.ProseMirror` cap above (`injectContentStyles`) — belt-and-suspenders
          in case the WebView's native container ever reports a height past
          that cap for some other reason; `overflow-hidden` here just clips
          the render, it doesn't bound layout on its own. */}
      <View className="max-h-[336px] min-h-[110px] w-full overflow-hidden rounded-[13px] border border-input bg-card">
        <RichText editor={editor} onLoad={injectContentStyles} />
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
