/** Pure release and version logic for the Android self-updater; no React Native imports so it runs under plain-node Vitest. */

export const RELEASES_REPO = "tryzenflow/releases";
export const APK_ASSET = "zenflow-android.apk";
const DOWNLOAD_PREFIX = `https://github.com/${RELEASES_REPO}/releases/download/`;

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** `-beta.N`; null for a stable release, which outranks every beta of the same x.y.z. */
  beta: number | null;
}

export interface GithubRelease {
  tag_name?: string;
  draft?: boolean;
  html_url?: string;
  body?: string | null;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
}

export interface AvailableUpdate {
  version: string;
  apkUrl: string;
  size: number | null;
  pageUrl: string;
}

/** "v0.1.0-beta.8" or "0.1.0" -> Version; null when it is neither. */
export function parseVersion(raw: string | undefined | null): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(raw?.trim() ?? "");
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    beta: m[4] === undefined ? null : Number(m[4]),
  };
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.beta === b.beta) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta - b.beta;
}

/**
 * The newest release that ships the Android APK from our own releases repo and
 * is newer than `current`; null when the app is up to date or nothing usable is
 * published. Only github.com release downloads are accepted as an APK source.
 */
export function pickUpdate(
  releases: GithubRelease[],
  current: string | undefined | null,
): AvailableUpdate | null {
  const installed = parseVersion(current);
  if (!installed) return null;
  let best: { version: Version; update: AvailableUpdate } | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    const version = parseVersion(release.tag_name);
    if (!version || compareVersions(version, installed) <= 0) continue;
    const asset = release.assets?.find(
      (a) =>
        a.name === APK_ASSET &&
        typeof a.browser_download_url === "string" &&
        a.browser_download_url.startsWith(DOWNLOAD_PREFIX),
    );
    if (!asset?.browser_download_url) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      version,
      update: {
        version: release.tag_name!.replace(/^v/, ""),
        apkUrl: asset.browser_download_url,
        size: typeof asset.size === "number" ? asset.size : null,
        pageUrl:
          release.html_url ?? `https://github.com/${RELEASES_REPO}/releases`,
      },
    };
  }
  return best?.update ?? null;
}
