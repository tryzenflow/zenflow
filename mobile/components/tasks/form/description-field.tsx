import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { getFileMetadata, uploadFiles } from "@/api/files";
import {
  Bold,
  Check,
  CheckSquare,
  ClipboardList,
  GraduationCap,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  Maximize2,
  Notebook,
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
import { getBaseURL } from "@/lib/api-client";
import { escapeHtml } from "@/lib/file-link";
import { loadGeistWebviewFontDataUri } from "@/lib/geist-webview-font";
import {
  LINK_TAP_SCRIPT,
  handleNoteLinkMessage,
  noteColors,
  noteFont,
  isNoteEmpty,
  noteSnippet,
  noteTypographyCss,
} from "@/lib/note-html";
import { toImageUploadPart } from "@/lib/picked-file";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import type { FileMetadata } from "@zenflow/shared";
import {
  BlockquoteBridge,
  BoldBridge,
  BulletListBridge,
  CoreBridge,
  type EditorTheme,
  HighlightBridge,
  ImageBridge,
  ItalicBridge,
  LinkBridge,
  OrderedListBridge,
  type RecursivePartial,
  RichText,
  UnderlineBridge,
  useBridgeState,
  useEditorBridge,
} from "@10play/tentap-editor";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WebViewMessageEvent } from "react-native-webview";
import { AudioBridge, VideoBridge } from "./media-bridges";

const HIGHLIGHT_COLOR = "#fde68a";

// `ImageBridge` is the library's own (wraps `@tiptap/extension-image`,
// pre-configured `allowBase64: true`, which also keeps notes written
// before signed URLs — with `data:` images — rendering). `VideoBridge`/
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

/**
 * Starter outlines offered while the note is empty. Only uses what the
 * editor's schema supports (bold, lists, blockquote — no headings), so each
 * section title is a bold line over an empty bullet to type into.
 */
const TEMPLATES: {
  key: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  sections: string[];
}[] = [
  {
    key: "study",
    icon: Notebook,
    title: "Study notes",
    hint: "Key ideas, questions, summary",
    sections: ["Key ideas", "Questions", "Summary"],
  },
  {
    key: "checklist",
    icon: CheckSquare,
    title: "Checklist",
    hint: "A simple to-do list",
    sections: ["To do"],
  },
  {
    key: "exam",
    icon: GraduationCap,
    title: "Exam prep",
    hint: "Topics, practice, formulas",
    sections: ["Topics to review", "Practice", "Remember"],
  },
  {
    key: "assignment",
    icon: ClipboardList,
    title: "Assignment brief",
    hint: "Goal, requirements, resources",
    sections: ["Goal", "Requirements", "Resources"],
  },
];

function templateHtml(sections: string[]): string {
  return sections
    .map((s) => `<p><strong>${escapeHtml(t(s))}</strong></p><ul><li></li></ul>`)
    .join("");
}

export function DescriptionField({
  initialValue,
  onChange,
  disabled,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  useLanguage();
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
        <DescriptionFieldEditor
          initialValue={value}
          onChange={(html) => {
            setValue(html);
            onChange(html);
          }}
          onClose={() => setOpen(false)}
          disabled={disabled}
        />
      </Modal>
    </>
  );
}

/**
 * The full-screen editor, mounted only while the modal is open (so the
 * WebView boots once per open, with the field's current content).
 */
function DescriptionFieldEditor({
  initialValue,
  onChange,
  onClose,
  disabled,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  useLanguage();
  const { isDarkColorScheme } = useColorScheme();
  const { toast } = useToast();
  // The content the editor currently owns: `initialValue` at first mount,
  // then whatever the user has typed since (kept current in `onChange`), or
  // whatever the parent later hands down as a new `initialValue`.
  //
  // The tentap WebView only reads `initialContent` once, when it first
  // loads. Anything that makes it reload afterwards — an Android window
  // resize when the keyboard dismisses, a WebView process recycle, a config
  // change — re-runs that bootstrap and silently snaps the visible document
  // back to the text it booted with. On the Edit screen that looked like a
  // just-saved note reverting to the old text the moment you hit Save (the
  // keyboard dismissing as the screen pops). `onLoad` below re-applies
  // `valueRef` whenever it has drifted from `bootContentRef` (the exact
  // string tentap booted with); the effect re-applies a genuinely new
  // `initialValue` handed down by the parent.
  const valueRef = useRef(initialValue);
  const bootContentRef = useRef(initialValue);
  const [linkOpen, setLinkOpen] = useState(false);
  const [isEmpty, setIsEmpty] = useState(() => isNoteEmpty(initialValue));
  // "selection": a text range is selected (or sits in a link) -> URL only, applied to that
  // text. "insert": nothing selected -> title + URL inserted as a new link at the end.
  const [linkMode, setLinkMode] = useState<"selection" | "insert">("insert");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [fontDataUri, setFontDataUri] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // iOS reports the keyboard frame early (`will*`) so the bar rides up with
  // it. Android resizes the window itself (`softwareKeyboardLayoutMode`), so
  // the bar needs no offset there.
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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

  // `useEditorBridge`'s `theme` param is `RecursivePartial<EditorTheme>`,
  // and `EditorTheme`'s fields are themselves `StyleProp<ViewStyle>` (RN
  // 0.88's much more deeply nested structural style types, see
  // `lib/native-style.ts`'s doc comment). Structurally checking an object
  // literal against `RecursivePartial<StyleProp<ViewStyle>>` — whether
  // inline, via a `satisfies`, or via a typed local — blows past TS's
  // instantiation-depth limit; the object below is exactly the shape
  // `EditorTheme["webview"]` expects (a plain `backgroundColor`), so bridge
  // through `unknown` rather than asking TS to prove it structurally.
  const editorTheme = {
    webview: {
      backgroundColor: isDarkColorScheme ? "rgb(29 26 23)" : "rgb(255 255 255)",
    },
  } as unknown as RecursivePartial<EditorTheme>;

  const editor = useEditorBridge({
    bridgeExtensions: EDITOR_EXTENSIONS,
    initialContent: initialValue,
    editable: !disabled,
    dynamicHeight: false,
    theme: editorTheme,
    onChange: () => {
      editor.getHTML().then((html) => {
        valueRef.current = html;
        setIsEmpty(isNoteEmpty(html));
        onChange(html);
      });
    },
  });

  function applyTemplate(sections: string[]) {
    const html = templateHtml(sections);
    valueRef.current = html;
    setIsEmpty(false);
    editor.setContent(html);
    onChange(html);
    editor.focus("end");
  }

  const state = useBridgeState(editor);

  // Re-sync when the parent hands down a genuinely different `initialValue`
  // (e.g. its own fetch resolves after this mounted). No-op for the common
  // case where the new prop just echoes what we last emitted.
  useEffect(() => {
    if (initialValue === valueRef.current) return;
    valueRef.current = initialValue;
    editor.setContent(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  function injectContentStyles() {
    const { bg, fg } = noteColors(isDarkColorScheme);
    const { fontFace, family } = noteFont(fontDataUri);
    editor.injectCSS(
      // Bottom padding keeps the last lines scrollable above the floating bar.
      `${fontFace} html, body { margin: 0; padding: 0; background-color: ${bg}; } .ProseMirror { box-sizing: border-box; background-color: ${bg}; color: ${fg}; font-family: ${family}; font-size: 17px; padding: 8px 20px 120px; line-height: 1.5; min-height: 100vh; } .ProseMirror > :first-child { margin-top: 0; } ${noteTypographyCss(".ProseMirror", isDarkColorScheme)}`,
      "description-field-theme",
    );
  }

  useEffect(() => {
    injectContentStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkColorScheme, fontDataUri]);

  // Taps on a link inside a contenteditable only move the cursor, so a
  // capturing click listener (see `lib/note-html.ts`) hands the href back to
  // RN, which opens it. Anything that isn't a link tap is Tentap's own
  // message and is deliberately not consumed (`exclusivelyUseCustomOnMessage`
  // is false below).
  function injectLinkTapHandler() {
    editor.webviewRef.current?.injectJavaScript(LINK_TAP_SCRIPT);
  }

  function handleWebviewMessage(event: WebViewMessageEvent) {
    handleNoteLinkMessage(event.nativeEvent.data, toast);
  }

  useEffect(() => {
    editor.setEditable(!disabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  function openLink() {
    // With text selected, `editor.setLink(url)` marks exactly that text (tentap's
    // LinkBridge runs `extendMarkRange('link').setLink(...)` on the selection).
    // Only a collapsed cursor can't take a link, so that case inserts a new
    // titled `<a>` at the end, the same way file uploads do.
    const onText = !!state.canSetLink || !!state.isLinkActive;
    setLinkMode(onText ? "selection" : "insert");
    setLinkTitle("");
    setLinkUrl(state.activeLink ?? "");
    setLinkOpen(true);
  }

  async function confirmLink() {
    let url = linkUrl.trim();
    if (linkMode === "selection") {
      // Empty URL on a selection removes the link; otherwise apply it.
      if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
      editor.setLink(url);
      setLinkOpen(false);
      return;
    }
    if (!url) {
      setLinkOpen(false);
      return;
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    const title = escapeHtml(linkTitle.trim() || url);
    const html = await editor.getHTML();
    const fullHtml = `${html} <a href="${escapeHtml(url)}">${title}</a>`;
    valueRef.current = fullHtml;
    editor.setContent(fullHtml);
    onChange(fullHtml);
    setLinkOpen(false);
  }

  // Files are embedded by URL: the backend returns a signed, session-less
  // `url` (`/api/v1/files/:id?sig=…`, relative to the API origin) that the
  // editor WebView — which has no session cookie — can load directly. This
  // keeps the saved note tiny instead of inlining the bytes as `data:` URIs.
  function fileEmbedMarkup(fileMetadata: FileMetadata): string {
    const baseURL = getBaseURL();
    if (!baseURL) throw new Error("API base URL is not configured");
    // Backends without signed-URL support omit `url`; fail the upload loudly
    // rather than saving a broken `…/undefined` embed into the note.
    if (!fileMetadata.url) throw new Error("File response has no url");
    const src = escapeHtml(new URL(fileMetadata.url, baseURL).toString());
    const name = escapeHtml(fileMetadata.originalName);
    if (fileMetadata.mimetype.startsWith("image/")) {
      return `<img src="${src}" alt="${name}" style="max-width: 100%;"/>`;
    }
    if (fileMetadata.mimetype.startsWith("audio/")) {
      return `<audio controls src="${src}" style="max-width: 100%;"></audio>`;
    }
    if (fileMetadata.mimetype.startsWith("video/")) {
      return `<video controls src="${src}" style="max-width: 100%;"></video>`;
    }
    return `<p><a href="${src}">${name}</a></p>`;
  }

  async function embedUploaded(
    parts: { uri: string; name: string; mimeType: string }[],
    failureMessage: string,
  ) {
    try {
      const uploaded = await uploadFiles(parts);

      let html = await editor.getHTML();
      for (const file of uploaded) {
        const fileMetadata = await getFileMetadata(file.id);
        html += fileEmbedMarkup(fileMetadata);
      }
      valueRef.current = html;
      editor.setContent(html);
      onChange(html);
    } catch {
      toast({
        title: failureMessage,
        description: t("Check your connection and try again."),
        variant: "destructive",
        icon: Upload,
      });
    }
  }

  async function handleUploadFile() {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
    } catch {
      toast({
        title: t("Couldn't open file picker"),
        description: t("Try again in a moment."),
        variant: "destructive",
        icon: Upload,
      });
      return;
    }
    if (result.canceled) return;

    await embedUploaded(
      result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
      })),
      t("Couldn't upload file"),
    );
  }

  // Native photo library picker (PHPicker on iOS, Photo Picker on Android) --
  // runs out-of-process and needs no runtime permission, so there is no
  // permission-denied path; picker errors are toasted. Name/mime fall back to
  // values derived from the uri, see `lib/picked-file.ts`.
  async function handleInsertImage() {
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 0.8,
      });
    } catch {
      toast({
        title: t("Couldn't open photo library"),
        description: t("Try again in a moment."),
        variant: "destructive",
        icon: ImagePlus,
      });
      return;
    }
    if (result.canceled) return;

    await embedUploaded(
      result.assets.map((asset) =>
        toImageUploadPart({
          uri: asset.uri,
          name: asset.fileName,
          mimeType: asset.mimeType,
        }),
      ),
      t("Couldn't upload image"),
    );
  }

  const tint = isDarkColorScheme
    ? "rgba(29, 26, 23, 0.55)"
    : "rgba(255, 255, 255, 0.55)";
  const borderColor = isDarkColorScheme
    ? "rgba(255, 255, 255, 0.18)"
    : "rgba(255, 255, 255, 0.7)";
  const sheen: [string, string, string] = isDarkColorScheme
    ? ["rgba(255,255,255,0.10)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0)"]
    : ["rgba(255,255,255,0.85)", "rgba(255,255,255,0.30)", "rgba(255,255,255,0)"];
  const barBottom =
    Platform.OS === "ios" && keyboardHeight > 0
      ? keyboardHeight + 20
      : insets.bottom + 20;

  return (
    <View
      className="flex-1 bg-background"
      style={{
        // Full-screen modal: it spans under the status bar / Dynamic Island.
        paddingTop: insets.top,
        // iOS: shrink the editor above the keyboard so the caret stays visible.
        paddingBottom: Platform.OS === "ios" ? keyboardHeight : 0,
      }}
    >
      <View className="flex-row items-center justify-between px-5 pb-2 pt-2">
        <Text className="text-[19px] font-bold tracking-tight">
          {t("Description")}
        </Text>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
          accessibilityLabel={t("Done")}
          className="h-9 flex-row items-center rounded-full bg-primary px-4"
        >
          <Text className="text-[14px] font-semibold text-primary-foreground">
            {t("Done")}
          </Text>
        </Pressable>
      </View>

      <View className="flex-1 bg-background">
        <RichText
          editor={editor}
          onLoad={() => {
            injectContentStyles();
            injectLinkTapHandler();
            // Fires on every WebView (re)load. If the current content has
            // drifted from what tentap booted with, this is a *reload* that
            // just snapped the document back — restore the real content.
            // On the very first load the two are equal, so this is a no-op.
            if (valueRef.current !== bootContentRef.current) {
              editor.setContent(valueRef.current);
            }
            if (!disabled) editor.focus("end");
          }}
          onMessage={handleWebviewMessage}
          exclusivelyUseCustomOnMessage={false}
        />
        {isEmpty && !disabled && (
          <View
            pointerEvents="box-none"
            className="absolute inset-x-5 top-16 gap-2.5"
          >
            <Text className="text-[13px] font-semibold text-muted-foreground">
              {t("Start with a template")}
            </Text>
            <View className="flex-row flex-wrap gap-2.5">
              {TEMPLATES.map((tpl) => (
                <Pressable
                  key={tpl.key}
                  onPress={() => applyTemplate(tpl.sections)}
                  accessibilityRole="button"
                  accessibilityLabel={t(tpl.title)}
                  className="w-[48%] gap-2 rounded-2xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07] p-3.5 active:bg-muted/50"
                >
                  <View className="h-9 w-9 items-center justify-center rounded-full bg-muted">
                    <tpl.icon size={18} className="text-foreground" />
                  </View>
                  <View className="gap-0.5">
                    <Text className="text-[14px] font-semibold">
                      {t(tpl.title)}
                    </Text>
                    <Text className="text-[12px] leading-4 text-muted-foreground">
                      {t(tpl.hint)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Floating glass bar (iOS Notes style): rides above the keyboard,
          same translucent fill / hairline border / sheen as the Next up pill. */}
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", left: 28, right: 28, bottom: barBottom }}
      >
        {linkOpen && (
          <View className="mb-2 gap-1.5 rounded-2xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07] p-2.5">
            {linkMode === "insert" && (
              <Input
                autoFocus
                editable={!disabled}
                value={linkTitle}
                onChangeText={setLinkTitle}
                placeholder={t("Title (optional)")}
                returnKeyType="next"
                className="h-10 rounded-full border border-input bg-background px-3.5 text-[13px] text-foreground"
              />
            )}
            <View className="flex-row items-center gap-1.5">
              <Input
                autoFocus={linkMode === "selection"}
                editable={!disabled}
                value={linkUrl}
                onChangeText={setLinkUrl}
                placeholder={t("Link URL")}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={() => void confirmLink()}
                className="h-10 flex-1 rounded-full border border-input bg-background px-3.5 text-[13px] text-foreground"
              />
              <Pressable
                onPress={() => void confirmLink()}
                accessibilityLabel={t("Confirm link")}
                className="h-10 w-10 items-center justify-center rounded-full bg-primary"
              >
                <Check size={16} className="text-primary-foreground" />
              </Pressable>
              <Pressable
                onPress={() => setLinkOpen(false)}
                accessibilityLabel={t("Cancel link")}
                className="h-10 w-10 items-center justify-center rounded-full bg-muted"
              >
                <X size={16} className="text-muted-foreground" />
              </Pressable>
            </View>
          </View>
        )}
        {/* Outer view carries the shadow only; rounding + clipping live inside. */}
        <View
          style={{
            width: "100%",
            borderRadius: 9999,
            shadowColor: "#000",
            shadowOpacity: isDarkColorScheme ? 0.4 : 0.14,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
            backgroundColor: tint,
          }}
        >
          <View
            style={{
              width: "100%",
              borderRadius: 9999,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor,
              overflow: "hidden",
              backgroundColor: tint,
            }}
          >
            <LinearGradient
              pointerEvents="none"
              colors={sheen}
              locations={[0, 0.4, 1]}
              style={StyleSheet.absoluteFill}
            />
            <ScrollView
              horizontal
              style={{ width: "100%", flexGrow: 0 }}
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={{
                alignItems: "center",
                gap: 2,
                paddingHorizontal: 14,
                paddingVertical: 5,
              }}
            >
              <ToolbarButton
                icon={Bold}
                label={t("Bold")}
                active={!!state.isBoldActive}
                disabled={disabled}
                onPress={() => editor.toggleBold()}
              />
              <ToolbarButton
                icon={Italic}
                label={t("Italic")}
                active={!!state.isItalicActive}
                disabled={disabled}
                onPress={() => editor.toggleItalic()}
              />
              <ToolbarButton
                icon={UnderlineIcon}
                label={t("Underline")}
                active={!!state.isUnderlineActive}
                disabled={disabled}
                onPress={() => editor.toggleUnderline()}
              />
              <ToolbarButton
                icon={Highlighter}
                label={t("Highlight")}
                active={!!state.activeHighlight}
                disabled={disabled}
                onPress={() => editor.toggleHighlight(HIGHLIGHT_COLOR)}
              />
              <ToolbarButton
                icon={Quote}
                label={t("Blockquote")}
                active={!!state.isBlockquoteActive}
                disabled={disabled}
                onPress={() => editor.toggleBlockquote()}
              />
              <View className="mx-1.5 h-5 w-px bg-black/10" />
              <ToolbarButton
                icon={List}
                label={t("Bulleted list")}
                active={!!state.isBulletListActive}
                disabled={disabled}
                onPress={() => editor.toggleBulletList()}
              />
              <ToolbarButton
                icon={ListOrdered}
                label={t("Numbered list")}
                active={!!state.isOrderedListActive}
                disabled={disabled}
                onPress={() => editor.toggleOrderedList()}
              />
              <View className="mx-1.5 h-5 w-px bg-black/10" />
              <ToolbarButton
                icon={Link2}
                label={t("Link")}
                active={linkOpen}
                disabled={disabled}
                onPress={openLink}
              />
              <ToolbarButton
                icon={ImagePlus}
                label={t("Insert image")}
                disabled={disabled}
                onPress={() => void handleInsertImage()}
              />
              <ToolbarButton
                icon={Upload}
                label={t("Upload file")}
                disabled={disabled}
                onPress={() => void handleUploadFile()}
              />
            </ScrollView>
          </View>
        </View>
      </View>
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
  useLanguage();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      className={cn(
        "h-12 w-12 items-center justify-center rounded-full active:bg-muted/30",
        // Light amber active-state fill (this bar's own accent, distinct
        // from the app's `bg-primary`) reads clearly against a white bar —
        // the old `bg-white/25`-on-dark-pill treatment would be invisible
        // here since the bar itself is now white.
        active && "bg-amber-100",
        disabled && "opacity-40",
      )}
    >
      <Icon size={21} className="text-foreground/70" />
    </Pressable>
  );
}
