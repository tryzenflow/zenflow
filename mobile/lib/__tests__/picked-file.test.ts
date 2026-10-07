import { describe, expect, it } from "vitest";
import {
  deriveImageMimeType,
  derivePickedName,
  toImageUploadPart,
} from "../picked-file";

describe("picked-file", () => {
  it("keeps a provided mime type", () => {
    expect(deriveImageMimeType("image/png", "x.jpg")).toBe("image/png");
  });
  it("derives mime from extension, ignoring query", () => {
    expect(deriveImageMimeType(undefined, "file:///a/B.PNG?x=1")).toBe(
      "image/png",
    );
    expect(deriveImageMimeType("", "file:///a/b.heic")).toBe("image/heic");
  });
  it("falls back to jpeg", () => {
    expect(deriveImageMimeType(null, "content://media/123")).toBe("image/jpeg");
  });
  it("derives name from uri or mime", () => {
    expect(derivePickedName(null, "file:///a/pic%20one.png", "image/png")).toBe(
      "pic one.png",
    );
    expect(derivePickedName("", "content://media/123", "image/webp")).toBe(
      "123.webp",
    );
    expect(derivePickedName("mine.jpg", "file:///z", "image/jpeg")).toBe(
      "mine.jpg",
    );
  });
  it("builds a full part", () => {
    expect(toImageUploadPart({ uri: "file:///c/img.gif" })).toEqual({
      uri: "file:///c/img.gif",
      name: "img.gif",
      mimeType: "image/gif",
    });
  });
});
