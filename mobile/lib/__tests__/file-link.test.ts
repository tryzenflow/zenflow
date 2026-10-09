import { describe, expect, it } from "vitest";
import {
  buildFileUrl,
  escapeHtml,
  parseFileIdFromHref,
  resolveNoteFileUrls,
  safeFileName,
} from "../file-link";

const BASE = "http://192.168.1.5:8000/api/v1";

describe("file-link", () => {
  it("round-trips a built url", () => {
    expect(parseFileIdFromHref(buildFileUrl(BASE, "abc-123_X"), BASE)).toBe(
      "abc-123_X",
    );
  });

  it("tolerates a trailing slash on the base", () => {
    expect(buildFileUrl(`${BASE}/`, "a1")).toBe(`${BASE}/files/a1`);
    expect(parseFileIdFromHref(`${BASE}/files/a1`, `${BASE}/`)).toBe("a1");
  });

  it("rejects other origins, paths and nested ids", () => {
    expect(parseFileIdFromHref("https://evil.test/api/v1/files/a1", BASE)).toBeNull();
    expect(parseFileIdFromHref(`${BASE}/files/metadata/a1`, BASE)).toBeNull();
    expect(parseFileIdFromHref("http://192.168.1.5:8000/files/a1", BASE)).toBeNull();
    expect(parseFileIdFromHref(`${BASE}/files/`, BASE)).toBeNull();
    expect(parseFileIdFromHref("data:text/plain;base64,AAAA", BASE)).toBeNull();
    expect(parseFileIdFromHref("not a url", BASE)).toBeNull();
    expect(parseFileIdFromHref(`${BASE}/files/a1`, undefined)).toBeNull();
  });

  it("sanitizes file names", () => {
    expect(safeFileName("../a/b:c.pdf")).toBe("_a_b_c.pdf");
    expect(safeFileName("..")).toBe("file");
  });

  it("escapes html", () => {
    expect(escapeHtml(`a"<b>&`)).toBe("a&quot;&lt;b&gt;&amp;");
  });
});

describe("resolveNoteFileUrls", () => {
  it("prefixes origin-relative file refs with the API origin", () => {
    const html =
      '<img src="/api/v1/files/a1?sig=s"><a href=\'/api/v1/files/b2\'>f</a>';
    expect(resolveNoteFileUrls(html, BASE)).toBe(
      '<img src="http://192.168.1.5:8000/api/v1/files/a1?sig=s">' +
        "<a href='http://192.168.1.5:8000/api/v1/files/b2'>f</a>",
    );
  });

  it("is idempotent and leaves other urls alone", () => {
    const html =
      '<img src="http://192.168.1.5:8000/api/v1/files/a1?sig=s"><a href="https://x.test/api/v1/files/z">x</a>';
    expect(resolveNoteFileUrls(html, BASE)).toBe(html);
  });

  it("is a no-op without a base URL", () => {
    const html = '<img src="/api/v1/files/a1">';
    expect(resolveNoteFileUrls(html, undefined)).toBe(html);
  });
});
