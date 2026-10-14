import { describe, expect, it } from "vitest";
import {
  APK_ASSET,
  type GithubRelease,
  compareVersions,
  parseVersion,
  pickUpdate,
} from "../app-update-version";

const v = (s: string) => parseVersion(s)!;

const release = (tag: string, extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  html_url: `https://github.com/tryzenflow/releases/releases/tag/${tag}`,
  assets: [
    {
      name: APK_ASSET,
      browser_download_url: `https://github.com/tryzenflow/releases/releases/download/${tag}/${APK_ASSET}`,
      size: 1234,
    },
  ],
  ...extra,
});

describe("parseVersion", () => {
  it("reads tags and package versions", () => {
    expect(parseVersion("v0.1.0-beta.8")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      beta: 8,
    });
    expect(parseVersion("1.2.3")?.beta).toBeNull();
  });

  it("rejects anything else", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("1.2.3-rc.1")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders betas, then stable above its betas, then higher x.y.z", () => {
    expect(compareVersions(v("0.1.0-beta.9"), v("0.1.0-beta.8"))).toBeGreaterThan(0);
    expect(compareVersions(v("0.1.0"), v("0.1.0-beta.99"))).toBeGreaterThan(0);
    expect(compareVersions(v("0.2.0-beta.1"), v("0.1.0"))).toBeGreaterThan(0);
    expect(compareVersions(v("0.1.0-beta.8"), v("0.1.0-beta.8"))).toBe(0);
  });
});

describe("pickUpdate", () => {
  it("returns the newest newer release with the APK", () => {
    const update = pickUpdate(
      [release("v0.1.0-beta.9"), release("v0.1.0-beta.10"), release("v0.1.0-beta.7")],
      "0.1.0-beta.8",
    );
    expect(update?.version).toBe("0.1.0-beta.10");
    expect(update?.size).toBe(1234);
    expect(update?.apkUrl).toContain("/v0.1.0-beta.10/zenflow-android.apk");
  });

  it("returns null when up to date or ahead", () => {
    expect(pickUpdate([release("v0.1.0-beta.8")], "0.1.0-beta.8")).toBeNull();
    expect(pickUpdate([release("v0.1.0-beta.7")], "0.1.0-beta.8")).toBeNull();
  });

  it("skips drafts, releases without the APK, and foreign download hosts", () => {
    expect(pickUpdate([release("v0.2.0", { draft: true })], "0.1.0")).toBeNull();
    expect(pickUpdate([release("v0.2.0", { assets: [] })], "0.1.0")).toBeNull();
    expect(
      pickUpdate(
        [
          release("v0.2.0", {
            assets: [
              { name: APK_ASSET, browser_download_url: "https://evil.test/zenflow-android.apk" },
            ],
          }),
        ],
        "0.1.0",
      ),
    ).toBeNull();
  });

  it("returns null when the installed version is unknown", () => {
    expect(pickUpdate([release("v0.2.0")], undefined)).toBeNull();
  });
});
