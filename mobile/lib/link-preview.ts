/**
 * Link previews for the read-only session view: the Open Graph / Twitter card
 * metadata of a page (title, description, image), like an X or Slack unfurl.
 * A WebView can't fetch other origins (CORS), so the app fetches the page
 * itself and hands the result to the card. Pages behind a login (the LMS) just
 * yield no metadata and keep the plain card.
 */
export interface LinkPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decode(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .trim();
}

/** `<meta property|name="key" content="…">` in either attribute order. */
function meta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const a = new RegExp(
      `<meta[^>]+(?:property|name)=["']${k}["'][^>]*?content=["']([^"']*)["']`,
      "i",
    ).exec(html);
    const b = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${k}["']`,
      "i",
    ).exec(html);
    const value = a?.[1] ?? b?.[1];
    if (value?.trim()) return decode(value);
  }
  return null;
}

export function parseLinkPreview(html: string, pageUrl: string): LinkPreview {
  const head = html.slice(0, 200_000);
  const title =
    meta(head, ["og:title", "twitter:title"]) ??
    (() => {
      const m = /<title[^>]*>([^<]*)<\/title>/i.exec(head);
      return m?.[1] ? decode(m[1]) : null;
    })();
  const rawImage = meta(head, [
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
  ]);
  let image: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        image = resolved.toString();
      }
    } catch {
      image = null;
    }
  }
  return {
    title: title || null,
    description: meta(head, [
      "og:description",
      "twitter:description",
      "description",
    ]),
    image,
    siteName: meta(head, ["og:site_name"]),
  };
}

const cache = new Map<string, Promise<LinkPreview | null>>();

/** Fetch a page's preview (cached per URL for the session). `null` on any failure or non-HTML. */
export function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    if (!/^https?:\/\//i.test(url)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (compatible; ZenflowLinkPreview/1.0; +https://zenflow.app)",
        },
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/text\/html|xhtml/i.test(type)) return null;
      const preview = parseLinkPreview(await res.text(), res.url || url);
      return preview.title || preview.image ? preview : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.set(url, p);
  return p;
}
