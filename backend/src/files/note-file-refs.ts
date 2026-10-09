/**
 * File references inside note HTML. Notes store the canonical sig-less form
 * (`/api/v1/files/<id>`); the API adds `?sig=` on read and strips it on save,
 * so rotating `FILE_URL_SECRET` never touches stored notes.
 */

export interface NoteFileRef {
  id: string;
  /** Has an `http(s)://origin` prefix. */
  absolute: boolean;
  sig?: string;
}

/** A quoted attribute value `[origin][/api/v1]/files/<id>[?sig=…]`. Anything
 * else (`/files/metadata/…`, other query params) never matches. */
const FILE_REF =
  /(["'])((?:https?:\/\/[^"'\s<>]*?)?(?:\/api\/v1)?\/files\/([A-Za-z0-9_-]+)(?:\?sig=([A-Za-z0-9_-]*))?)\1/g;

export const canonicalFileUrl = (id: string): string => `/api/v1/files/${id}`;

/**
 * Rewrite each file reference. `fn` returns the replacement URL, or `undefined`
 * to leave that reference untouched (e.g. a third-party host that merely looks
 * like ours).
 */
export function rewriteNoteFileRefs(
  html: string,
  fn: (ref: NoteFileRef) => string | undefined,
): string {
  return html.replace(
    FILE_REF,
    (match, quote: string, url: string, id: string, sig?: string) => {
      const next = fn({ id, absolute: /^https?:/i.test(url), sig });
      return next === undefined ? match : `${quote}${next}${quote}`;
    },
  );
}

/** Ids of every file reference in `html`, de-duplicated. */
export function extractNoteFileIds(html: string): string[] {
  const ids = new Set<string>();
  rewriteNoteFileRefs(html, (ref) => {
    ids.add(ref.id);
    return undefined;
  });
  return [...ids];
}
