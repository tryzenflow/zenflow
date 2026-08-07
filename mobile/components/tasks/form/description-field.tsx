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

const HIGHLIGHT_COLOR = "#fde68a";

const PROSEMIRROR_MAX_HEIGHT = 540;

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
  const [linkDraft, setLinkDraft] = useState("");
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

    const fontFace = fontDataUri
      ? `@font-face { font-family: 'Geist'; src: url(${fontDataUri}) format('truetype'); font-weight: 400; font-style: normal; }`
      : "";
    const fontFamily = fontDataUri
      ? "'Geist', -apple-system, sans-serif"
      : "-apple-system, sans-serif";
    editor.injectCSS(
      `${fontFace} body { background-color: ${bg}; } .ProseMirror { background-color: ${bg}; color: ${fg}; font-family: ${fontFamily}; font-size: 16px; padding: 4px 12px; line-height: 1.5; max-height: ${PROSEMIRROR_MAX_HEIGHT}px; overflow-y: auto; }`,
      "description-field-theme",
    );
  }

  useEffect(() => {
    injectContentStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkColorScheme, fontDataUri]);

  useEffect(() => {
    editor.setEditable(!disabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

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
    <View ref={containerRef}>
      <View className="max-h-[556px] min-h-[110px] w-full overflow-hidden rounded-t-[13px] border border-b-0 border-input bg-card">
        <RichText
          editor={editor}
          onLoad={injectContentStyles}
          containerStyle={{ height: PROSEMIRROR_MAX_HEIGHT }}
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
