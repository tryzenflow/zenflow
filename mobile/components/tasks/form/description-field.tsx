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
import { useScrollIntoViewOnFocus } from "@/components/tasks/task-form-screen";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { loadGeistWebviewFontDataUri } from "@/lib/geist-webview-font";
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
 * KNOWN GAP vs. web: the toolbar is a floating pill shown/hidden by
 * `state.isFocused` (an absolutely-positioned overlay straddling the
 * editor's top edge), not a bubble anchored to the exact text-selection
 * caret position like web's Tiptap bubble menu. `tentap-editor`'s
 * `CoreEditorState` bridge state exposes a `selection: { from, to }` text
 * *offset* pair but no WebView-internal screen *coordinates* for that
 * selection, so there's nothing to anchor a true per-caret bubble to from
 * native — showing/hiding on focus is the closest reasonable approximation
 * given that constraint (revisit if a future `tentap-editor` version adds
 * coordinate reporting). Deliberately gated on *focus*, not "has a non-empty
 * selection": Upload has no selection-dependent behavior and needs to stay
 * reachable with nothing selected, so gating on selection emptiness would
 * hide it exactly when it's needed. Marks/lists can be toggled with or
 * without a text selection (typing then continues in that style), which is
 * more correct WYSIWYG behavior than a selection-required toolbar anyway.
 *
 * KNOWN GAP vs. web (scoped down deliberately): the web editor
 * (`frontend/src/components/common/editor/video-block.tsx`/`audio-block.tsx`)
 * registers its own Tiptap `Node.create(...)` extensions for embedded video
 * and audio. `@10play/tentap-editor`'s `bridgeExtensions` API
 * (`node_modules/@10play/tentap-editor/.../bridges/*.d.ts`) only ships an
 * `ImageBridge` (a bare `setImage(src)`, no matching video/audio bridge, and
 * no attrs for `controls`/sizing the way the web nodes have) — there's no
 * ergonomic extension point here to register a *new* custom Tiptap node from
 * the native side; the WebView document's own bundled JS bundle would need
 * to be patched to add one, which isn't a stable thing to take on in this
 * pass. Scoped this batch down to polishing the existing link-insert row
 * instead — Upload stays a stub toast, and image/video embedding remains an
 * explicit follow-up.
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
  const [fontDataUri, setFontDataUri] = useState<string | null>(null);
  const lastEmitted = useRef(value);
  const containerRef = useRef<View>(null);
  const scrollIntoView = useScrollIntoViewOnFocus();

  // Base64-embed Geist as a `@font-face` inside the editor's WebView
  // document once (see `lib/geist-webview-font.ts`'s doc comment for why a
  // data URI is required instead of just naming the font). Best-effort: if
  // the asset read fails for some reason, the stylesheet below just falls
  // back to the system sans-serif, same as before this fix.
  useEffect(() => {
    let cancelled = false;
    loadGeistWebviewFontDataUri()
      .then((uri) => {
        if (!cancelled) setFontDataUri(uri);
      })
      .catch(() => {
        // no-op — font-family falls back to -apple-system/sans-serif below
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // The WebView editor doesn't participate in RN's built-in "scroll the
  // focused input above the keyboard" behavior (that's `TextInputState`-
  // driven and only knows about real native `TextInput`s) — without this,
  // focusing the editor when it sits below the fold just leaves it under the
  // keyboard once Android's window-resize (`app.config.ts`) shrinks the
  // available height. `useScrollIntoViewOnFocus` (from `TaskFormScreen`)
  // reaches up to the form's single `ScrollView` and asks it to scroll this
  // editor's wrapping `View` into view the same way it would for a focused
  // `TextInput`.
  useEffect(() => {
    if (state.isFocused) {
      scrollIntoView(containerRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isFocused]);

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
  // `8px 12px` was originally chosen to match web's `px-3 py-2` Tailwind
  // classes exactly, but that reads as too much inset on a much narrower
  // mobile viewport — tightened to `6px 10px` here (mobile-only; the web
  // editor keeps its own `px-3 py-2`, they don't need to match pixel-for-
  // pixel since they're different viewport classes).
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
    // `@font-face` is only emitted once the base64 data URI has finished
    // loading (see the effect above) — until then the WebView falls back to
    // its default sans-serif rather than blocking on the asset read.
    const fontFace = fontDataUri
      ? `@font-face { font-family: 'Geist'; src: url(${fontDataUri}) format('truetype'); font-weight: 400; font-style: normal; }`
      : "";
    const fontFamily = fontDataUri
      ? "'Geist', -apple-system, sans-serif"
      : "-apple-system, sans-serif";
    editor.injectCSS(
      `${fontFace} body { background-color: ${bg}; } .ProseMirror { background-color: ${bg}; color: ${fg}; font-family: ${fontFamily}; font-size: 14px; padding: 6px 10px; line-height: 1.5; max-height: 320px; overflow-y: auto; }`,
      "description-field-theme",
    );
  }

  useEffect(() => {
    injectContentStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkColorScheme, fontDataUri]);

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
    <View ref={containerRef} className="gap-1.5">
      {/* Static, always-rendered bar — was a floating, absolutely-positioned
          pill straddling the editor's top edge, shown/hidden by
          `state.isFocused`/`linkOpen`. Two real problems with that: it
          overlapped Android's own text-selection toolbar (the native
          copy/paste/select-all bar the OS renders over a focused/selected
          WebView — an absolutely-positioned sibling can't avoid colliding
          with something the OS itself draws over the WebView's content), and
          it didn't reliably hide on blur. A plain in-flow block above the
          WebView container can never spatially collide with anything the OS
          renders over the WebView, and always rendering it removes the
          hide/show state entirely — no more not-hiding-on-blur bug because
          there's no hiding to get wrong. Deliberately white-background/
          black-icons regardless of the app's light/dark scheme — this needs
          to read as an editor toolbar, not another chrome surface. */}
      <View className="flex-row flex-wrap items-center gap-0.5 rounded-t-[13px] border border-b-0 border-input bg-white p-1">
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
        <View className="mx-1 h-4 w-px bg-black/10" />
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
        <View className="mx-1 h-4 w-px bg-black/10" />
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

      {/* `max-h` is a second, outer safety net alongside the injected
          `.ProseMirror` cap above (`injectContentStyles`) — belt-and-suspenders
          in case the WebView's native container ever reports a height past
          that cap for some other reason; `overflow-hidden` here just clips
          the render, it doesn't bound layout on its own. */}
      <View className="max-h-[336px] min-h-[110px] w-full overflow-hidden rounded-b-[13px] border border-input bg-card">
        <RichText editor={editor} onLoad={injectContentStyles} />
      </View>

      {linkOpen && (
        <View className="flex-row items-center gap-1.5">
          <Input
            autoFocus
            editable={!disabled}
            value={linkDraft}
            onChangeText={setLinkDraft}
            placeholder="Enter link…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={confirmLink}
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

      <Text className="text-[12.5px] leading-snug text-muted-foreground">
        Tap into the editor to reveal formatting — Bold, Italic, Underline,
        Highlight, Blockquote, Link, Bulleted and Numbered lists.
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
        "h-[30px] w-[30px] items-center justify-center rounded-full active:bg-black/10",
        // Light amber active-state fill (this bar's own accent, distinct
        // from the app's `bg-primary`) reads clearly against a white bar —
        // the old `bg-white/25`-on-dark-pill treatment would be invisible
        // here since the bar itself is now white.
        active && "bg-amber-100",
        disabled && "opacity-40",
      )}
    >
      <Icon size={14} className="text-neutral-900" />
    </Pressable>
  );
}
