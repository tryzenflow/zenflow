import { describe, expect, it } from "vitest";
import { droppedUploads } from "../files-tracker";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const link = (id: string, sig = "") =>
  `<p><a href="https://api.example/api/v1/files/${id}${sig}">f</a></p>`;

describe("droppedUploads", () => {
  it("returns uploads the final note no longer mentions", () => {
    expect(droppedUploads([A, B], link(A))).toEqual([B]);
  });

  it("delete, re-add, delete: only the final note counts", () => {
    // uploaded A, removed it, uploaded B (same name), removed it, re-added A
    expect(droppedUploads([A, B, A], link(A))).toEqual([B]);
    expect(droppedUploads([A, B], "<p>nothing</p>")).toEqual([A, B]);
  });

  it("keeps a file referenced as a signed URL or an <img>", () => {
    expect(droppedUploads([A], link(A, "?sig=abc"))).toEqual([]);
    expect(droppedUploads([A], `<img src="/api/v1/files/${A}">`)).toEqual([]);
  });

  it("matches whole ids: a prefix of a kept id is not 'kept'", () => {
    const short = "abc";
    expect(droppedUploads([short], link("abcdef"))).toEqual([short]);
    expect(droppedUploads(["abcdef"], link("abc"))).toEqual(["abcdef"]);
  });

  it("treats an empty or missing note as dropping everything", () => {
    expect(droppedUploads([A], "")).toEqual([A]);
    expect(droppedUploads([A], null)).toEqual([A]);
    expect(droppedUploads([A], undefined)).toEqual([A]);
  });

  it("de-duplicates and never returns an empty id", () => {
    expect(droppedUploads([A, A, ""], "")).toEqual([A]);
  });

  it("returns nothing when nothing was uploaded", () => {
    expect(droppedUploads([], link(A))).toEqual([]);
  });
});
