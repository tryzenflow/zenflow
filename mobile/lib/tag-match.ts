/**
 * Tag-name matching for the tag autocomplete dropdown (`CreateSessionSheet` /
 * `EditSessionSheet` tags field, RN migration Phase 5 / GitHub issue #20).
 *
 * `mockups/feedback.md` item 5 flags: "The tag autocomplete is strange when
 * the prefix is far from the remaining text." Investigating the web
 * implementation (`frontend/src/components/tasks/form/tag-field.tsx`)
 * confirms the bug: its `<Command>` list runs through cmdk's *default*
 * filter, a scattered-character fuzzy scorer (`command-score`). That scorer
 * happily matches e.g. "de" against "backend-team"
 * (b-a-c-k-e-n-**d**-**e**-a-m) with a non-trivial score even though "de"
 * isn't a meaningful substring there, and doesn't reliably rank a true
 * prefix match above a scattered one — exactly "strange when the prefix is
 * far from the remaining text". (`frontend/src/components/tasks/form/
 * title-field.tsx`'s combobox sidesteps this entirely with
 * `shouldFilter={false}`, since it filters server-side — only the tags
 * combobox is affected.)
 *
 * There's no cmdk/RN equivalent to reach for here, so this from-scratch
 * matcher is written to not repeat that bug: it only ever considers
 * *contiguous* occurrences (exact match, then prefix, then substring),
 * never scattered characters, and always ranks a prefix match strictly
 * above a mid-string substring match. That directly fixes the reported
 * behaviour — documented here as "fixed" (not "confirmed absent") since the
 * web bug is real and this port deliberately avoids reintroducing it.
 */
export function matchTags(query: string, candidates: string[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;

  const scored: { name: string; rank: number }[] = [];
  for (const name of candidates) {
    const lower = name.toLowerCase();
    if (lower === q) {
      scored.push({ name, rank: 0 });
    } else if (lower.startsWith(q)) {
      scored.push({ name, rank: 1 });
    } else {
      const idx = lower.indexOf(q);
      if (idx >= 0) scored.push({ name, rank: 2 + idx / lower.length });
    }
  }

  scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return scored.map((s) => s.name);
}
