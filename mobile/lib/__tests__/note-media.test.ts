import { describe, expect, it } from "vitest";
import {
  MEDIA_OPEN_MESSAGE,
  mediaPlayerScript,
  noteMediaCss,
  parseOpenMediaMessage,
} from "../note-media";

describe("parseOpenMediaMessage", () => {
  it("accepts an image or video tap and ignores anything else", () => {
    const msg = (o: object) => JSON.stringify({ type: MEDIA_OPEN_MESSAGE, ...o });
    expect(parseOpenMediaMessage(msg({ kind: "image", src: "http://x/a.png" }))).toEqual({
      kind: "image",
      src: "http://x/a.png",
    });
    expect(parseOpenMediaMessage(msg({ kind: "video", src: "v" }))?.kind).toBe("video");
    expect(parseOpenMediaMessage(msg({ kind: "audio", src: "v" }))).toBeNull();
    expect(parseOpenMediaMessage(JSON.stringify({ type: "other" }))).toBeNull();
    expect(parseOpenMediaMessage("not json")).toBeNull();
  });
});

const c = { fg: "#111", muted: "#888", link: "#f80" };

describe("mediaPlayerScript", () => {
  const labels = { title: "Available online", hint: "h", retry: "r" };
  it("is syntactically valid JavaScript offline and online", () => {
    for (const offline of [true, false]) {
      expect(() => new Function(mediaPlayerScript({ offline, labels }))).not.toThrow();
    }
  });
  it("embeds the labels safely", () => {
    const js = mediaPlayerScript({
      offline: true,
      labels: { title: 'a"b</script>', hint: "h", retry: "r" },
    });
    expect(() => new Function(js)).not.toThrow();
  });
  it("themes for both color schemes", () => {
    expect(noteMediaCss("body", true, c)).not.toBe(noteMediaCss("body", false, c));
  });
});
