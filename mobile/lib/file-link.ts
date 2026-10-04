/**
 * Pure helpers for non-media file links in task notes (no React Native
 * imports, so they stay unit-testable under vitest).
 *
 * Uploaded non-media files are stored in the note as a plain
 * `<a href="{apiBase}/files/{id}">name</a>`. The `/files/:id` endpoint is
 * cookie-auth protected and the system browser has no session, so taps on
 * these links are intercepted in the editor and downloaded through the
 * authenticated `api` client instead (see `api/files.ts`).
 */

const FILE_ID = /^[A-Za-z0-9_-]+$/;

function trimTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

/** Absolute `/files/:id` URL under the API base (e.g. `http://h:8000/api/v1`). */
export function buildFileUrl(baseURL: string, id: string): string {
  return `${trimTrailingSlashes(baseURL)}/files/${encodeURIComponent(id)}`;
}

/**
 * Returns the file id when `href` is one of our own `/files/:id` URLs (same
 * origin and path prefix as the API base), otherwise `null`. Matching the
 * origin keeps unrelated external links on the normal `Linking` path.
 */
export function parseFileIdFromHref(
  href: string,
  baseURL: string | undefined,
): string | null {
  if (!baseURL) return null;
  let url: URL;
  let base: URL;
  try {
    url = new URL(href);
    base = new URL(baseURL);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  const prefix = `${trimTrailingSlashes(base.pathname)}/files/`;
  if (!url.pathname.startsWith(prefix)) return null;
  try {
    const id = decodeURIComponent(url.pathname.slice(prefix.length));
    return FILE_ID.test(id) ? id : null;
  } catch {
    return null; // malformed percent-encoding
  }
}

/** Strip path separators / control chars so a name is safe as a cache file name. */
export function safeFileName(name: string, fallback = "file"): string {
  const cleaned = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
    .replace(/[\x00-\x1f\\/:*?"<>|]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || fallback;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
