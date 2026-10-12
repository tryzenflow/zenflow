import { MAX_UPLOAD_BYTES, type FileLimits } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { extractServerMessage } from "./save-error";
import { t } from "./i18n";

const MB = 1024 * 1024;

let maxFileBytes = MAX_UPLOAD_BYTES;

/** Apply the server's effective limits (`GET /files/limits`); defaults hold until then. */
export function setUploadLimits(limits: Pick<FileLimits, "maxFileBytes">): void {
  maxFileBytes = limits.maxFileBytes;
}

/** Picked files split by the per-file cap; unknown sizes pass (the server decides). */
export function splitOversize<T extends { size?: number | null }>(
  parts: T[],
): { ok: T[]; tooLarge: T[] } {
  const ok: T[] = [];
  const tooLarge: T[] = [];
  for (const p of parts) {
    (p.size != null && p.size > maxFileBytes ? tooLarge : ok).push(p);
  }
  return { ok, tooLarge };
}

/** "Title\nDescription" for a toast when the server refused an upload (413). */
export function tooLargeToast(): string {
  return `${t("File too large")}\n${t("Each file can be up to {size} MB.", {
    size: Math.round(maxFileBytes / MB),
  })}`;
}

/** Toast text for a 413 from `/files/upload` (file cap or per-user quota); null for other errors. */
export function describeUploadError(error: unknown): string | null {
  if (!isAxiosError(error) || error.response?.status !== 413) return null;
  const message = extractServerMessage(error.response.data);
  if (message === t("Storage full")) {
    return `${t("Storage full")}\n${t("Remove files from your notes, or use smaller ones.")}`;
  }
  return tooLargeToast();
}
