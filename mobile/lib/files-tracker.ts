// Pure (no React Native imports) so it runs under the unit-test config.

/**
 * Of the files uploaded during one form session, the ones the final note no
 * longer mentions. A plain substring test on the whole note is deliberate: a
 * file id is a UUID, and counting any mention as "still used" can only keep a
 * file, never delete one that is in use. Ids are matched whole, so one id that
 * prefixes another cannot hide or expose it.
 */
export function droppedUploads(
  uploaded: readonly string[],
  finalNote: string | null | undefined,
): string[] {
  const note = finalNote ?? "";
  const mentioned = (id: string) =>
    new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(id)}(?![A-Za-z0-9_-])`).test(note);
  return [...new Set(uploaded)].filter((id) => id && !mentioned(id));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
