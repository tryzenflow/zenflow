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
  return `${selector} blockquote { border-left: 3px solid ${link}; margin: 8px 0; padding-left: 12px; color: ${muted}; } ${selector} a { color: ${link}; text-decoration: underline; } ${selector} img, ${selector} video { max-width: 100%; max-height: 320px; width: auto; object-fit: contain; border-radius: 8px; } ${selector} audio { max-width: 100%; } ${selector} mark { border-radius: 3px; color: rgb(28 25 23) !important; } ${selector} mark * { color: inherit !important; } ${selector} ul, ${selector} ol { padding-left: 22px; } ${selector} p { margin: 0 0 8px; } ${selector} { color: ${fg}; }`;
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

/**
 * Read-only view: a link that is the whole of its paragraph becomes a preview
 * card; a link inside running text stays an inline link. With page metadata
 * (`window.ZF_PREVIEWS`, fetched by the app, see `lib/link-preview.ts`) the card
 * is an unfurl: cover image, title, description, host. Without it, a compact
 * card with the link text and host. The transform runs in the WebView
 * (`LINK_CARD_SCRIPT`) before the height is measured.
 */
export function noteLinkCardCss(
  selector: string,
  isDark: boolean,
  reduceMotion = false,
) {
  const { fg, muted, link } = noteColors(isDark);
  const fill = isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.7)";
  const edge = isDark ? "rgba(255,150,80,0.30)" : "rgba(255,142,62,0.32)";
  return `${selector} a.zf-card { display: block; margin: 6px 0 12px; border: 1px solid ${edge}; border-radius: 16px; background: ${fill}; color: ${fg}; text-decoration: none; overflow: hidden; } ${selector} a.zf-card .zf-img { display: block; width: 100%; aspect-ratio: 1.91 / 1; object-fit: cover; background: ${edge}; max-height: none; border-radius: 0; } ${selector} a.zf-card .zf-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; } ${selector} a.zf-card .zf-ico { flex: none; width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: ${link}; color: #fff; } ${selector} a.zf-card .zf-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; } ${selector} a.zf-card .zf-title { font-weight: 600; font-size: 15px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } ${selector} a.zf-card .zf-desc { font-size: 13px; line-height: 1.35; color: ${muted}; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } ${selector} a.zf-card .zf-host { font-size: 12px; color: ${muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } ${selector} a.zf-card .zf-go { flex: none; color: ${muted}; } @keyframes zf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } } ${selector} a.zf-card .zf-shimmer, ${selector} a.zf-card .zf-bar { animation: ${reduceMotion ? "none" : "zf-pulse 1.2s ease-in-out infinite"}; } ${selector} a.zf-card .zf-bar { display: block; height: 12px; border-radius: 6px; background: ${edge}; }`;
}

export const LINK_CARD_SCRIPT = `
  (function() {
    var link = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
    var go = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>';
    var previews = window.ZF_PREVIEWS || {};
    var pending = window.ZF_PENDING || [];
    function esc(s) { return String(s).replace(/[&<>"]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
    document.querySelectorAll('#note p').forEach(function(p) {
      var links = p.querySelectorAll('a');
      if (links.length !== 1) return;
      var a = links[0];
      if (p.textContent.trim() !== a.textContent.trim()) return;
      var host = '';
      try { host = new URL(a.href).hostname.replace(/^www\\./, ''); } catch (e) {}
      var text = a.textContent.trim();
      var isUrl = /^https?:\\/\\//i.test(text);
      var pv = previews[a.getAttribute('href')] || previews[a.href] || null;
      if (!pv && (pending.indexOf(a.getAttribute('href')) > -1 || pending.indexOf(a.href) > -1)) {
        // Metadata still loading: a skeleton card of the final shape, so the
        // unfurl fills in without the page jumping.
        a.classList.add('zf-card');
        a.innerHTML = '<span class="zf-img zf-shimmer"></span><span class="zf-row"><span class="zf-txt"><span class="zf-bar" style="width:70%"></span><span class="zf-bar" style="width:95%"></span><span class="zf-bar" style="width:45%"></span></span></span>';
        return;
      }
      var title = (pv && pv.title) || (isUrl ? host : text);
      var desc = pv && pv.description;
      var sub = (pv && pv.siteName) || host;
      a.classList.add('zf-card');
      var img = pv && pv.image ? '<img class="zf-img" src="' + esc(pv.image) + '" onerror="this.remove()" />' : '';
      var icon = img ? '' : '<span class="zf-ico">' + link + '</span>';
      a.innerHTML = img + '<span class="zf-row">' + icon + '<span class="zf-txt"><span class="zf-title">' + esc(title) + '</span>' + (desc ? '<span class="zf-desc">' + esc(desc) + '</span>' : '') + '<span class="zf-host">' + esc(sub) + '</span></span><span class="zf-go">' + go + '</span></span>';
    });
  })();
`;
