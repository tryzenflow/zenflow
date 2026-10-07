import { downloadFileToCache } from "@/api/files";
import { getBaseURL } from "@/lib/api-client";
import { parseFileIdFromHref } from "@/lib/file-link";
import { t } from "@/lib/i18n";
import { Link2, Upload } from "@/components/Icons";
import type { useToast } from "@/components/ui/toast";
import { Linking } from "react-native";

/**
 * Shared by the description editor (`components/tasks/form/description-field.tsx`)
 * and the read-only session view (`components/tasks/session-view.tsx`): both
 * render note HTML inside a WebView document that can't see the app's CSS
 * variables, so the palette is repeated here as literals.
 */

export const LINK_TAP_MESSAGE = "zenflow-open-link";
export const HEIGHT_MESSAGE = "zenflow-note-height";

export function noteColors(isDark: boolean) {
  return {
    bg: isDark ? "rgb(29 26 23)" : "rgb(255 255 255)",
    fg: isDark ? "rgb(250 250 249)" : "rgb(28 25 23)",
    muted: isDark ? "rgb(168 162 158)" : "rgb(120 113 108)",
    // Same brand-orange triplets as `--brand-orange` in `app/global.css`.
    link: isDark ? "rgb(255 122 36)" : "rgb(255 142 62)",
  };
}

/** Geist `@font-face` (when the data URI loaded) + the matching family stack. */
export function noteFont(fontDataUri: string | null) {
  return {
    fontFace: fontDataUri
      ? `@font-face { font-family: 'Geist'; src: url(${fontDataUri}) format('truetype'); font-weight: 400; font-style: normal; }`
      : "",
    family: fontDataUri
      ? "'Geist', -apple-system, sans-serif"
      : "-apple-system, sans-serif",
  };
}

/** Typography shared by the editor's `.ProseMirror` and the viewer's `body`. */
export function noteTypographyCss(selector: string, isDark: boolean) {
  const { fg, muted, link } = noteColors(isDark);
  return `${selector} blockquote { border-left: 3px solid ${link}; margin: 8px 0; padding-left: 12px; color: ${muted}; } ${selector} a { color: ${link}; text-decoration: underline; } ${selector} img, ${selector} video { max-width: 100%; max-height: 320px; width: auto; object-fit: contain; border-radius: 8px; } ${selector} audio { max-width: 100%; } ${selector} mark { border-radius: 3px; } ${selector} ul, ${selector} ol { padding-left: 22px; } ${selector} p { margin: 0 0 8px; } ${selector} { color: ${fg}; }`;
}

/** Injected into a WebView: hands a tapped link's href back to RN. */
export const LINK_TAP_SCRIPT = `
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
`;

type Toast = ReturnType<typeof useToast>["toast"];

/**
 * Handles a WebView message; returns true when it was a link tap (consumed).
 * Our own `/files/:id` links are cookie-auth protected, so they're downloaded
 * through the authenticated client and handed to the OS viewer; anything else
 * opens in the system browser.
 */
export function handleNoteLinkMessage(raw: string, toast: Toast): boolean {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { type?: unknown }).type !== LINK_TAP_MESSAGE
  ) {
    return false;
  }
  const href = (data as { href?: unknown }).href;
  if (typeof href !== "string") return true;
  const fileId = parseFileIdFromHref(href, getBaseURL());
  if (fileId) {
    void downloadFileToCache(fileId)
      .then(({ file, mimeType, name }) => file.preview({ mimeType, title: name }))
      .catch(() => {
        toast({
          title: t("Couldn't open file"),
          description: t("Try again in a moment."),
          variant: "destructive",
          icon: Upload,
        });
      });
    return true;
  }
  Linking.openURL(href).catch(() => {
    toast({
      title: t("Couldn't open link"),
      description: t("Try again in a moment."),
      variant: "destructive",
      icon: Link2,
    });
  });
  return true;
}

/** Plain-text snippet of note HTML, for the collapsed description card. */
export function noteSnippet(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/blockquote)\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the note has no text and no embedded media. */
export function isNoteEmpty(html: string): boolean {
  return noteSnippet(html) === "" && !/<(img|video|audio)\b/i.test(html);
}
