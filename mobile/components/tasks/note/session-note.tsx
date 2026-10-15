import { NoteSkeleton } from "@/components/tasks/note-skeleton";
import { useToast } from "@/components/ui/toast";
import { getBaseURL } from "@/lib/api-client";
import { resolveNoteFileUrls } from "@/lib/file-link";
import { loadGeistWebviewFontDataUri } from "@/lib/geist-webview-font";
import {
  LINK_TAP_SCRIPT,
  handleNoteLinkMessage,
  noteColors,
  noteFont,
  noteTypographyCss,
} from "@/lib/note-html";
import { useColorScheme } from "@/lib/useColorScheme";
import { useEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

/** A read-only note document. The WebView has no app CSS, so the palette comes from `note-html`. */
export function sessionNoteDocument(
  html: string,
  isDark: boolean,
  fontDataUri: string | null,
  baseURL: string | undefined,
): string {
  const { bg, fg } = noteColors(isDark);
  const { fontFace, family } = noteFont(fontDataUri);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fontFace} html, body { margin: 0; padding: 0; background-color: ${bg}; } body { box-sizing: border-box; padding: 4px 0 40px; color: ${fg}; font-family: ${family}; font-size: 16px; line-height: 1.5; } ${noteTypographyCss("body", isDark)} body ul[data-type="taskList"] input { pointer-events: none; }</style></head><body>${resolveNoteFileUrls(html, baseURL)}</body></html>`;
}

/**
 * A session's note, read-only. Mounted only when the detail sheet reaches its
 * full snap, so the WebView and the Geist font load on demand.
 */
export function SessionNote({ html }: { html: string }) {
  const { isDarkColorScheme } = useColorScheme();
  const { toast } = useToast();
  const { height } = useWindowDimensions();
  const [fontDataUri, setFontDataUri] = useState<string | null>(null);
  // The WebView mounts once the font settles, so its document loads once
  // instead of reloading when the font arrives.
  const [fontSettled, setFontSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGeistWebviewFontDataUri()
      .then((uri) => {
        if (!cancelled) setFontDataUri(uri);
      })
      .catch(() => {
        // Best effort: the document falls back to the system sans-serif.
      })
      .finally(() => {
        if (!cancelled) setFontSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const source = useMemo(
    () => ({
      html: sessionNoteDocument(html, isDarkColorScheme, fontDataUri, getBaseURL()),
    }),
    [html, isDarkColorScheme, fontDataUri],
  );

  if (!fontSettled) return <NoteSkeleton />;

  return (
    <WebView
      testID="session-note"
      source={source}
      originWhitelist={["*"]}
      injectedJavaScript={LINK_TAP_SCRIPT}
      onMessage={(event: WebViewMessageEvent) =>
        handleNoteLinkMessage(event.nativeEvent.data, toast)
      }
      style={{
        height: Math.round(height * 0.5),
        backgroundColor: noteColors(isDarkColorScheme).bg,
      }}
    />
  );
}
