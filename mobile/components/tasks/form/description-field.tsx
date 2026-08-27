import { fetchFileDataUri, getFileMetadata, uploadFiles } from "@/api/files";
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
import type { FileMetadata } from "@/types/files";
import {
  BlockquoteBridge,
  BoldBridge,
  BulletListBridge,
  CoreBridge,
  HighlightBridge,
  ImageBridge,
  ItalicBridge,
  LinkBridge,
  OrderedListBridge,
  RichText,
  UnderlineBridge,
  useBridgeState,
  useEditorBridge,
} from "@10play/tentap-editor";
import * as DocumentPicker from "expo-document-picker";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, View } from "react-native";
import type { WebViewMessageEvent } from "react-native-webview";
import { AudioBridge, VideoBridge } from "./media-bridges";

const HIGHLIGHT_COLOR = "#fde68a";

// `ImageBridge` is the library's own (wraps `@tiptap/extension-image`,
// pre-configured `allowBase64: true` — needed since uploaded files are
// embedded as `data:` URIs, see `fileEmbedMarkup` below). `VideoBridge`/
// `AudioBridge` are this app's own (see `./media-bridges`'s doc comment) —
// the library ships no equivalent for those tags. Without all three, the
// WebView's ProseMirror schema has no node type for `<img>`/`<video>`/
// `<audio>`, so `editor.setContent()` silently drops them: uploaded media
// never rendered at all, regardless of the embedded `src`.
const EDITOR_EXTENSIONS = [
  CoreBridge,
  BoldBridge,
  ItalicBridge,
  UnderlineBridge,
  HighlightBridge,
  BlockquoteBridge,
  LinkBridge,
  ImageBridge,
  VideoBridge,
  AudioBridge,
  BulletListBridge,
  OrderedListBridge,
];

export function DescriptionField(props: {
  initialValue: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return <DescriptionFieldEditor {...props} />;
}

function DescriptionFieldEditor({
  initialValue,
  onChange,
  disabled,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const { toast } = useToast();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [fontDataUri, setFontDataUri] = useState<string | null>(null);
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
    initialContent: initialValue,
    editable: !disabled,
    dynamicHeight: false,
    theme: {
      webview: {
        backgroundColor: isDarkColorScheme
          ? "rgb(29 26 23)"
          : "rgb(255 255 255)",
      },
    },
    onChange: () => {
      editor.getHTML().then((html) => {
        onChange(html);
      });
    },
  });

  const state = useBridgeState(editor);

  useEffect(() => {
    if (state.isFocused) {
      scrollIntoView(containerRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isFocused]);

  function injectContentStyles() {
    const bg = isDarkColorScheme ? "rgb(29 26 23)" : "rgb(255 255 255)";
    const fg = isDarkColorScheme ? "rgb(250 250 249)" : "rgb(28 25 23)";
    // Same brand-orange RGB triplets as `--brand-orange` in
    // `app/global.css` — this is a separate WebView document, so it can't
    // reach that CSS variable and needs the literal value repeated here.
    const linkColor = isDarkColorScheme ? "rgb(255 122 36)" : "rgb(255 142 62)";

    const fontFace = fontDataUri
      ? `@font-face { font-family: 'Geist'; src: url(${fontDataUri}) format('truetype'); font-weight: 400; font-style: normal; }`
      : "";
    const fontFamily = fontDataUri
      ? "'Geist', -apple-system, sans-serif"
      : "-apple-system, sans-serif";
    editor.injectCSS(
      // `ImageBridge`'s own `extendCSS` (see `./media-bridges`) only sets
      // `max-width: 100%; height: auto` — an uploaded photo at its native
      // resolution can still render taller than this editor's whole fixed-
      // height container, forcing a scroll fight between the WebView's
      // internal scroll and the outer form's. Capping `max-height` here
      // keeps any embedded image/video to a sane thumbnail-ish size, same
      // idea as the web editor's `prose-img:max-h-64` (`frontend/src/
      // index.css`).
      `${fontFace} body { background-color: ${bg}; } .ProseMirror { background-color: ${bg}; color: ${fg}; font-family: ${fontFamily}; font-size: 15px; padding: 4px 12px; line-height: 0.8; overflow-y: auto; } .ProseMirror a { color: ${linkColor}; text-decoration: underline; } .ProseMirror img, .ProseMirror video { max-height: 200px; width: auto; object-fit: contain; border-radius: 8px; }`,
      "description-field-theme",
    );
  }

  useEffect(() => {
    injectContentStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkColorScheme, fontDataUri]);

  // `LinkBridge` (`@10play/tentap-editor`) configures Tiptap's `Link` with
  // `openOnClick: false` — and even `true` wouldn't help: a browser's
  // native behavior inside `contenteditable` is to place the cursor on a
  // link tap, not follow it (that's the whole reason `openOnClick` exists
  // as an override in the first place), and this library's WebView has no
  // `onShouldStartLoadWithRequest`/`onOpenWindow` wired up to catch a
  // `window.open()` call even if we did enable it. So taps on a link
  // inside this editor currently do nothing at all. Fixed with our own
  // capturing click listener injected straight into the WebView's DOM —
  // independent of `openOnClick` — that hands the tapped href back to RN
  // via `postMessage`, same channel Tentap's own bridge messages use (see
  // `handleWebviewMessage` below), then opens it with the system browser.
  const LINK_TAP_MESSAGE = "zenflow-open-link";

  function injectLinkTapHandler() {
    editor.webviewRef.current?.injectJavaScript(`
      (function() {
        if (window.__zenflowLinkTapBound) return true;
        window.__zenflowLinkTapBound = true;
        document.addEventListener('click', function(e) {
          var a = e.target && e.target.closest ? e.target.closest('a') : null;
          if (!a || !a.href) return;
          e.preventDefault();
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: ${JSON.stringify(LINK_TAP_MESSAGE)},
            href: a.href,
          }));
        }, true);
      })();
      true;
    `);
  }

  function handleWebviewMessage(event: WebViewMessageEvent) {
    let data: unknown;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return; // not JSON — not ours, and not Tentap's either; ignore.
    }
    if (
      typeof data === "object" &&
      data !== null &&
      (data as { type?: unknown }).type === LINK_TAP_MESSAGE
    ) {
      const href = (data as { href?: unknown }).href;
      if (typeof href === "string") {
        Linking.openURL(href).catch(() => {
          toast("Couldn't open that link.", "destructive");
        });
      }
    }
    // Any other message (bold/italic state, document height, …) is
    // Tentap's own — deliberately not consumed here, see
    // `exclusivelyUseCustomOnMessage={false}` below.
  }

  useEffect(() => {
    editor.setEditable(!disabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  function openLink() {
    // `LinkBridge`'s `onBridgeMessage`/`extendEditorState` run inside
    // `@10play/tentap-editor`'s statically-bundled WebView HTML, not this RN
    // module — there's no way to patch its `extendMarkRange('link')`-on-a-
    // collapsed-selection no-op from here (confirmed empirically: a custom
    // `BridgeExtension` with a fixed `onBridgeMessage` typechecks and
    // constructs fine, but the WebView only ever runs its own pre-compiled
    // handler for a given extension name). `editor.setLink()` therefore
    // can't reliably apply a link mark to a text selection from RN at all —
    // so this skips the select-text-first flow entirely and just inserts a
    // brand-new `<a>` (title + link) at the end of the content instead, the
    // same way file uploads already do it. No dependency on
    // `state.canSetLink`/`isLinkActive`/selection.
    setLinkTitle("");
    setLinkUrl("");
    setLinkOpen(true);
  }

  async function confirmLink() {
    const url = linkUrl.trim();
    if (!url) {
      setLinkOpen(false);
      return;
    }
    const title = linkTitle.trim() || url;
    const html = await editor.getHTML();
    const fullHtml = `${html} <a href="${url}">${title}</a>`;
    editor.setContent(fullHtml);
    onChange(fullHtml);
    setLinkOpen(false);
  }

  // Files are embedded as `data:` URIs (fetched via the authenticated `api`
  // client, see `api/files.ts`'s `fetchFileDataUri`) rather than a bare
  // backend URL — the WebView rendering this editor has its own cookie jar,
  // disconnected from `lib/api-client.ts`'s replayed session `Cookie`
  // header, so a plain `<img src>` pointed at the `CookieAuthGuard`-protected
  // `/files/:id` endpoint 401s silently with nothing rendered.
  async function fileEmbedMarkup(fileMetadata: FileMetadata): Promise<string> {
    const dataUri = await fetchFileDataUri(
      fileMetadata.id,
      fileMetadata.mimetype,
    );
    if (fileMetadata.mimetype.startsWith("image/")) {
      return `<img src="${dataUri}" alt="${fileMetadata.originalName}" style="max-width: 100%;"/>`;
    }
    if (fileMetadata.mimetype.startsWith("audio/")) {
      return `<audio controls src="${dataUri}" style="max-width: 100%;"></audio>`;
    }
    if (fileMetadata.mimetype.startsWith("video/")) {
      return `<video controls src="${dataUri}" style="max-width: 100%;"></video>`;
    }
    return `<a href="${dataUri}" download="${fileMetadata.originalName}">${fileMetadata.originalName}</a>`;
  }

  async function handleUploadFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    try {
      const uploaded = await uploadFiles(
        result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? "application/octet-stream",
        })),
      );

      let html = await editor.getHTML();
      for (const file of uploaded) {
        const fileMetadata = await getFileMetadata(file.id);
        html += await fileEmbedMarkup(fileMetadata);
      }
      editor.setContent(html);
      onChange(html);
    } catch {
      toast("Couldn't upload the file. Try again.", "destructive");
    }
  }

  return (
    <View ref={containerRef}>
      <View className="min-h-[300px] max-h-[400px] w-full overflow-hidden rounded-t-[13px] border border-b-0 border-input bg-card">
        <RichText
          editor={editor}
          onLoad={() => {
            injectContentStyles();
            injectLinkTapHandler();
          }}
          onMessage={handleWebviewMessage}
          exclusivelyUseCustomOnMessage={false}
        />
      </View>
      <View className="flex-row flex-wrap items-center gap-0.5 rounded-b-[13px] border border-input bg-background p-1">
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
          active={linkOpen}
          disabled={disabled}
          onPress={openLink}
        />
        <ToolbarButton
          icon={Upload}
          label="Upload file"
          disabled={disabled}
          onPress={() => void handleUploadFile()}
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

      {linkOpen && (
        <View className="mt-2 gap-1.5">
          <Input
            autoFocus
            editable={!disabled}
            value={linkTitle}
            onChangeText={setLinkTitle}
            placeholder="Title (optional)"
            returnKeyType="next"
            className="h-10 rounded-full border border-input bg-card px-3.5 text-[13px] text-foreground"
          />
          <View className="flex-row items-center gap-1.5">
            <Input
              editable={!disabled}
              value={linkUrl}
              onChangeText={setLinkUrl}
              placeholder="Link URL"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={() => void confirmLink()}
              className="h-10 flex-1 rounded-full border border-input bg-card px-3.5 text-[13px] text-foreground"
            />
            <Pressable
              onPress={() => void confirmLink()}
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
        </View>
      )}
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
        "h-10 w-10 items-center justify-center rounded-full active:bg-muted/30",
        // Light amber active-state fill (this bar's own accent, distinct
        // from the app's `bg-primary`) reads clearly against a white bar —
        // the old `bg-white/25`-on-dark-pill treatment would be invisible
        // here since the bar itself is now white.
        active && "bg-amber-100",
        disabled && "opacity-40",
      )}
    >
      <Icon size={14} className="text-muted-foreground" />
    </Pressable>
  );
}
