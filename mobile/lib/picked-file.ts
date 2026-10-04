/**
 * Pure helpers to normalise picker results into upload parts (no React Native
 * imports, so they stay unit-testable under vitest). Pickers can return
 * assets with a missing/blank `name` or `mimeType`; derive both from the uri.
 */

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

function lastSegment(uri: string): string {
  const clean = uri.split(/[?#]/)[0] ?? "";
  const seg = clean.slice(clean.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function extOf(name: string): string | null {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return null;
  return name.slice(i + 1).toLowerCase();
}

export function deriveImageMimeType(
  mimeType: string | null | undefined,
  nameOrUri: string,
): string {
  const given = mimeType?.trim();
  if (given?.includes("/")) return given;
  const ext = extOf(lastSegment(nameOrUri));
  return (ext && EXT_TO_MIME[ext]) || "image/jpeg";
}

export function derivePickedName(
  name: string | null | undefined,
  uri: string,
  mimeType: string,
  fallbackBase = "image",
): string {
  const given = name?.trim();
  if (given) return given;
  const seg = lastSegment(uri).trim();
  if (seg && extOf(seg)) return seg;
  const ext = MIME_TO_EXT[mimeType] ?? "jpg";
  return `${seg || fallbackBase}.${ext}`;
}

export function toImageUploadPart(asset: {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
}): { uri: string; name: string; mimeType: string } {
  const mimeType = deriveImageMimeType(asset.mimeType, asset.name || asset.uri);
  return {
    uri: asset.uri,
    name: derivePickedName(asset.name, asset.uri, mimeType),
    mimeType,
  };
}
