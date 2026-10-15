import { MediaViewer } from "@/components/tasks/media-viewer";
import { NoteSkeleton } from "@/components/tasks/note-skeleton";
import { useToast } from "@/components/ui/toast";
import { useOffline } from "@/hooks/use-offline";
import { getBaseURL } from "@/lib/api-client";
import { parseFileIdFromHref, resolveNoteFileUrls } from "@/lib/file-link";
import { formatBytes } from "@/lib/file-size";
import { fileSizesFor } from "@/lib/file-sizes";
import { loadGeistWebviewFontDataUri } from "@/lib/geist-webview-font";
import { t } from "@/lib/i18n";
import { type LinkPreview, fetchLinkPreview } from "@/lib/link-preview";
import { DURATION, timeTo, useReducedMotion } from "@/lib/motion";
import {
  HEIGHT_MESSAGE,
  LINK_CARD_SCRIPT,
  LINK_TAP_SCRIPT,
  handleNoteLinkMessage,
  noteColors,
  noteFont,
  noteLinkCardCss,
  noteTypographyCss,
} from "@/lib/note-html";
import {
  type OpenMedia,
  isFileUrl,
  mediaPlayerScript,
  noteMediaCss,
  parseOpenMediaMessage,
} from "@/lib/note-media";
import { useColorScheme } from "@/lib/useColorScheme";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, {
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

/**
 * A session's note, read-only: rich text, images, the audio and video players,
 * link preview cards and document cards. Mounted only when the detail sheet
 * reaches its full snap, so the WebView loads on demand.
 */
export function SessionNote({ html: raw }: { html: string }) {
  const html = useMemo(() => resolveNoteFileUrls(raw, getBaseURL()), [raw]);
  const { isDarkColorScheme } = useColorScheme();
  const { toast } = useToast();
  const offline = useOffline();
  const [viewing, setViewing] = useState<OpenMedia | null>(null);
  const [height, setHeight] = useState(40);
  // The WebView paints late and then resizes to the note; hold it invisible
  // behind a skeleton until its first height arrives, then fade it in.
  const [ready, setReady] = useState(false);
  const fade = useSharedValue(0);
  const [fontDataUri, setFontDataUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGeistWebviewFontDataUri()
      .then((uri) => {
        if (!cancelled) setFontDataUri(uri);
      })
      .catch(() => {
        // falls back to the system sans-serif
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Link-only paragraphs become preview cards; fetch each target's Open Graph
  // metadata (title, description, cover image) and rebuild the page with it.
  // Until a fetch settles the card is a skeleton of the final shape.
  const [previews, setPreviews] = useState<Record<string, LinkPreview>>({});
  const [settled, setSettled] = useState<Record<string, true>>({});
  const previewUrls = useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(
            html.matchAll(
              /<p[^>]*>\s*<a [^>]*href="([^"]+)"[^>]*>[^<]*<\/a>\s*<\/p>/gi,
            ),
            (m) => m[1].replace(/&amp;/g, "&"),
          ).filter((u) => /^https?:\/\//i.test(u) && !isFileUrl(u)),
        ),
      ),
    [html],
  );
  const pendingUrls = useMemo(
    () => previewUrls.filter((u) => !settled[u]),
    [previewUrls, settled],
  );
  useEffect(() => {
    let cancelled = false;
    for (const url of previewUrls) {
      fetchLinkPreview(url).then((p) => {
        if (cancelled) return;
        if (p) setPreviews((prev) => ({ ...prev, [url]: p }));
        setSettled((prev) => ({ ...prev, [url]: true }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [previewUrls]);

  // Document cards show the file's size. The metadata endpoint needs the
  // session, which the WebView doesn't have, so it is fetched here (once per
  // file, then kept) and handed to the page by link.
  const [fileSizes, setFileSizes] = useState<Record<string, string>>({});
  const fileLinks = useMemo(() => {
    const byHref: Record<string, string> = {};
    for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/gi)) {
      const href = m[1].replace(/&amp;/g, "&");
      const id = isFileUrl(href)
        ? parseFileIdFromHref(href, getBaseURL())
        : null;
      if (id) byHref[href] = id;
    }
    return byHref;
  }, [html]);
  useEffect(() => {
    const ids = Array.from(new Set(Object.values(fileLinks)));
    if (ids.length === 0) return;
    let cancelled = false;
    void fileSizesFor(ids, !offline).then((found) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [href, id] of Object.entries(fileLinks)) {
        if (found[id] !== undefined) next[href] = formatBytes(found[id]);
      }
      setFileSizes((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [fileLinks, offline]);

  const reduceMotion = useReducedMotion();
  const webViewStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  function markReady() {
    if (ready) return;
    setReady(true);
    fade.value = timeTo(1, reduceMotion);
  }
  // Never leave the skeleton up if the page never reports a height.
  useEffect(() => {
    const timer = setTimeout(markReady, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const source = useMemo(() => {
    const { fg } = noteColors(isDarkColorScheme);
    const { fontFace, family } = noteFont(fontDataUri);
    return {
      html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>${fontFace} html, body { margin: 0; padding: 0; background: transparent; } #note { display: flow-root; padding-bottom: 6px; } body { color: ${fg}; font-family: ${family}; font-size: 16px; line-height: 1.55; word-wrap: break-word; } ${noteTypographyCss("body", isDarkColorScheme)} ${noteLinkCardCss("body", isDarkColorScheme, reduceMotion)} ${noteMediaCss("body", isDarkColorScheme, noteColors(isDarkColorScheme))}</style></head><body><div id="note">${html}</div><script>window.ZF_PREVIEWS = ${JSON.stringify(previews).replace(/</g, "\\u003c")}; window.ZF_PENDING = ${JSON.stringify(pendingUrls).replace(/</g, "\u003c")}; window.ZF_FILE_SIZES = ${JSON.stringify(fileSizes).replace(/</g, "\u003c")};</script></body></html>`,
    };
  }, [
    html,
    isDarkColorScheme,
    fontDataUri,
    previews,
    pendingUrls,
    fileSizes,
    reduceMotion,
  ]);
  // The page is rebuilt when connectivity flips, so media swaps to / from placeholders.
  const sourceKey = offline ? "offline" : "online";

  const injected = `${LINK_TAP_SCRIPT}
    ${mediaPlayerScript({
      offline,
      labels: {
        offline: t("Offline"),
        failed: t("Couldn't load. Tap to retry."),
      },
    })}
    ${LINK_CARD_SCRIPT}
    (function() {
      function post() {
        var el = document.getElementById('note');
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: ${JSON.stringify(HEIGHT_MESSAGE)},
          height: Math.ceil(el.getBoundingClientRect().height),
        }));
      }
      post();
      window.addEventListener('load', post);
      document.querySelectorAll('img, video, audio').forEach(function(m) {
        m.addEventListener('load', post);
        m.addEventListener('loadedmetadata', post);
      });
      if (window.ResizeObserver) new ResizeObserver(post).observe(document.getElementById('note'));
    })();
    true;
  `;

  function onMessage(event: WebViewMessageEvent) {
    const raw = event.nativeEvent.data;
    if (handleNoteLinkMessage(raw, toast)) return;
    const media = parseOpenMediaMessage(raw);
    if (media) {
      setViewing(media);
      return;
    }
    try {
      const data = JSON.parse(raw) as { type?: string; height?: number };
      if (data.type === HEIGHT_MESSAGE && typeof data.height === "number") {
        setHeight(Math.max(24, data.height));
        markReady();
      }
    } catch {
      // not ours
    }
  }

  return (
    <View className="gap-2">
      <View style={{ minHeight: ready ? undefined : 124 }}>
        {!ready && (
          <Animated.View
            exiting={reduceMotion ? undefined : FadeOut.duration(DURATION.fast)}
            className="absolute inset-x-0 top-1"
            pointerEvents="none"
          >
            <NoteSkeleton />
          </Animated.View>
        )}
        <Animated.View
          style={webViewStyle}
        >
          <WebView
            testID="session-note"
            key={sourceKey}
            originWhitelist={["*"]}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            source={source}
            style={{ height, backgroundColor: "transparent" }}
            scrollEnabled={false}
            bounces={false}
            nestedScrollEnabled={false}
            // iOS needs the view itself non-opaque for the transparent page to show the sheet behind.
            opaque={false}
            injectedJavaScript={injected}
            onMessage={onMessage}
            onError={markReady}
            // Links are routed through `handleNoteLinkMessage`; never navigate in-place.
            onShouldStartLoadWithRequest={(req) => req.url === "about:blank"}
          />
        </Animated.View>
      </View>
      <MediaViewer media={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}
