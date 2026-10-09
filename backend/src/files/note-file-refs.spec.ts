import {
  extractNoteFileIds,
  rewriteNoteFileRefs,
  canonicalFileUrl,
} from "./note-file-refs";

describe("rewriteNoteFileRefs", () => {
  const to = (html: string) =>
    rewriteNoteFileRefs(html, (r) => canonicalFileUrl(r.id));

  it("rewrites relative, absolute, signed and legacy refs", () => {
    const html =
      '<img src="http://h:8000/api/v1/files/a1?sig=xyz"><a href="/api/v1/files/b2">f</a>' +
      "<audio src='/files/c3'></audio>";
    expect(to(html)).toBe(
      '<img src="/api/v1/files/a1"><a href="/api/v1/files/b2">f</a>' +
        "<audio src='/api/v1/files/c3'></audio>",
    );
  });

  it("ignores metadata paths, other queries and plain text", () => {
    const html =
      '<a href="/api/v1/files/metadata/a1">m</a><a href="/api/v1/files/a1?x=1">x</a> /api/v1/files/a1';
    expect(to(html)).toBe(html);
  });

  it("leaves a ref alone when fn returns undefined", () => {
    const html = '<a href="https://lms.example/api/v1/files/9">x</a>';
    expect(rewriteNoteFileRefs(html, () => undefined)).toBe(html);
  });

  it("reports absolute and sig", () => {
    const seen: unknown[] = [];
    rewriteNoteFileRefs(
      '<img src="https://h/api/v1/files/a?sig=s"><img src="/api/v1/files/b">',
      (r) => (seen.push(r), undefined),
    );
    expect(seen).toEqual([
      { id: "a", absolute: true, sig: "s" },
      { id: "b", absolute: false, sig: undefined },
    ]);
  });
});

describe("extractNoteFileIds", () => {
  it("de-duplicates", () => {
    expect(
      extractNoteFileIds(
        '<img src="/api/v1/files/a"><img src="/api/v1/files/a?sig=q"><a href="/api/v1/files/b">',
      ),
    ).toEqual(["a", "b"]);
  });
});
