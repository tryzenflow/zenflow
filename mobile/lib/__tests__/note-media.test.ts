import { describe, expect, it } from "vitest";
import {
  AUDIO_NAME_RE,
  VIDEO_NAME_RE,
  MEDIA_OPEN_MESSAGE,
  isFileUrl,
  mediaPlayerScript,
  noteMediaCss,
  parseOpenMediaMessage,
} from "../note-media";

describe("parseOpenMediaMessage", () => {
  it("accepts an image or video tap and ignores anything else", () => {
    const msg = (o: object) =>
      JSON.stringify({ type: MEDIA_OPEN_MESSAGE, ...o });
    expect(
      parseOpenMediaMessage(msg({ kind: "image", src: "http://x/a.png" })),
    ).toEqual({
      kind: "image",
      src: "http://x/a.png",
    });
    expect(parseOpenMediaMessage(msg({ kind: "video", src: "v" }))?.kind).toBe(
      "video",
    );
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
      expect(
        () => new Function(mediaPlayerScript({ offline, labels })),
      ).not.toThrow();
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
    expect(noteMediaCss("body", true, c)).not.toBe(
      noteMediaCss("body", false, c),
    );
  });
});

describe("audio links", () => {
  it("tells signed file links from web pages and audio names from documents", () => {
    expect(isFileUrl("https://api.x/api/v1/files/abc?sig=1")).toBe(true);
    expect(isFileUrl("https://example.com/files")).toBe(false);
    expect(AUDIO_NAME_RE.test("voice memo.M4A")).toBe(true);
    expect(AUDIO_NAME_RE.test("notes.pdf")).toBe(false);
    expect(VIDEO_NAME_RE.test("clip.MP4")).toBe(true);
    expect(VIDEO_NAME_RE.test("voice.m4a")).toBe(false);
  });

  it("the player script turns an audio link into a player", () => {
    const js = mediaPlayerScript({
      offline: false,
      labels: { title: "t", hint: "h", retry: "r" },
    });
    expect(js).toContain("AUDIO_NAME");
    expect(js).toContain("VIDEO_NAME");
    expect(js).toContain(String.raw`/\/files\/[^/?#]+\?/`);
  });
});

describe("offline and error placeholders", () => {
  const js = mediaPlayerScript({
    offline: true,
    labels: { title: "t", hint: "h", retry: "r" },
  });
  it("covers images offline and never stacks placeholders", () => {
    expect(js).toContain("if (OFFLINE) return placeholder(img)");
    expect(js).toContain("__zfBox");
  });
});
