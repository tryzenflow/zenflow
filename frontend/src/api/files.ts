import { api } from "./base";

/**
 * Fetch a file's bytes through the authenticated `api` client and return a
 * `data:` URI. Mirrors `mobile/api/files.ts`'s `fetchFileDataUri`.
 *
 * In production the frontend and API are cross-site (Netlify FE, API behind
 * TLS — see `backend/src/app.module.ts`'s `COOKIE_SAMESITE=none` comment), so
 * a bare `<img src>`/`<video src>`/`<audio src>` (or `<a href>`) pointed
 * straight at the `CookieAuthGuard`-protected `/files/:id` endpoint doesn't
 * carry the session cookie as a subresource request, 401s silently, and the
 * un-sized element collapses to a near-invisible sliver. Fetching the bytes
 * through the already-authenticated `api` client and inlining them as a
 * `data:` URI sidesteps that — the browser never needs to authenticate the
 * request itself.
 */
export async function fetchFileDataUri(id: string): Promise<string> {
  const response = await api.get(`/files/${id}`, { responseType: "blob" });
  const blob = response.data as Blob;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read downloaded file"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
