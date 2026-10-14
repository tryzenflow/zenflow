import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";
import {
  type AvailableUpdate,
  type GithubRelease,
  RELEASES_REPO,
  pickUpdate,
} from "./app-update-version";

/** Android-only: the APK in `tryzenflow/releases` is the only distribution, and iOS has no sideloaded update path. */
export const SUPPORTS_SELF_UPDATE = Platform.OS === "android";

const GRANT_READ_URI_PERMISSION = 1;
const APK_MIME = "application/vnd.android.package-archive";

/** Full version including `-beta.N` (see `releaseVersion` in app.config.ts). */
export function installedVersion(): string | undefined {
  const v = Constants.expoConfig?.extra?.releaseVersion;
  return typeof v === "string" ? v : undefined;
}

/** The newest published release newer than this build, or null (also null on any network or parse failure: updating is never blocking). */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!SUPPORTS_SELF_UPDATE) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=10`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return null;
    const releases = (await res.json()) as GithubRelease[];
    return Array.isArray(releases)
      ? pickUpdate(releases, installedVersion())
      : null;
  } catch {
    return null;
  }
}

/**
 * Download the APK to the cache and open Android's installer on it. The system
 * asks the user to confirm (and, the first time, to allow installs from Zenflow);
 * Android only accepts it when it is signed with the same key as this install.
 */
export async function downloadAndInstall(
  update: AvailableUpdate,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const target = `${FileSystem.cacheDirectory}zenflow-update.apk`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  const download = FileSystem.createDownloadResumable(
    update.apkUrl,
    target,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total = totalBytesExpectedToWrite || update.size || 0;
      if (total > 0) onProgress?.(Math.min(totalBytesWritten / total, 1));
    },
  );
  const result = await download.downloadAsync();
  if (!result || result.status !== 200) {
    throw new Error(`Download failed (${result?.status ?? "no response"})`);
  }
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: GRANT_READ_URI_PERMISSION,
    type: APK_MIME,
  });
}
