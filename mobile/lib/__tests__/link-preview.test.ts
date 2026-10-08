import { describe, expect, it } from "vitest";
import { parseLinkPreview } from "../link-preview";

describe("parseLinkPreview", () => {
  it("reads Open Graph tags in either attribute order and decodes entities", () => {
    const html = `<head>
      <meta property="og:title" content="Tom &amp; Jerry">
      <meta content="A cartoon." property="og:description">
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Toons">
    </head>`;
    expect(parseLinkPreview(html, "https://toons.example/show/1")).toEqual({
      title: "Tom & Jerry",
      description: "A cartoon.",
      image: "https://toons.example/img/cover.png",
      siteName: "Toons",
    });
  });

  it("falls back to twitter tags and <title>", () => {
    const html = `<title>Plain page</title><meta name="twitter:image" content="https://cdn.example/a.jpg">`;
    const p = parseLinkPreview(html, "https://x.example");
    expect(p.title).toBe("Plain page");
    expect(p.image).toBe("https://cdn.example/a.jpg");
  });

  it("rejects non-http images and returns nulls for bare pages", () => {
    const p = parseLinkPreview(
      `<meta property="og:image" content="javascript:alert(1)">`,
      "https://x.example",
    );
    expect(p.image).toBeNull();
    expect(p.title).toBeNull();
  });
});
