import { isAxiosError } from "axios";

/** Timeout (ms) for create/edit saves — a note with embedded images is a big
 * body on a mobile uplink, well past the client-wide 8s default. */
export const SAVE_TIMEOUT_MS = 30_000;

export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the server\nCheck your connection and try again.";
export const TIMEOUT_ERROR_MESSAGE =
  "The server took too long to respond\nYour changes may not have been saved. Check your connection and try again.";
export const TOO_LARGE_ERROR_MESSAGE =
  "That note is too large to save\nRemove large images from the note and try again.";
export const SERVER_ERROR_MESSAGE =
  "Something went wrong on our end\nTry again in a moment.";

/** A server-sent `message` as a non-empty string (Nest validation pipes send
 * `string[]`), else undefined. HTML/proxy bodies are ignored. */
export function extractServerMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const m = (data as { message?: unknown }).message;
  if (typeof m === "string") return m.trim() || undefined;
  if (Array.isArray(m)) {
    const parts = m.filter((x): x is string => typeof x === "string" && !!x);
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

/**
 * Map any caught save failure to a user-facing toast message (optionally
 * "\n"-split into title + description, see `splitToastMessage`). Never
 * returns an empty string.
 */
export function describeSaveError(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const res = error.response;
  if (!res) {
    const timedOut =
      error.code === "ECONNABORTED" ||
      error.code === "ETIMEDOUT" ||
      /timeout/i.test(error.message ?? "");
    return timedOut ? TIMEOUT_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE;
  }
  if (res.status === 413) return TOO_LARGE_ERROR_MESSAGE;
  const serverMessage = extractServerMessage(res.data);
  // A 5xx body is usually Nest's generic "Internal server error" (or a proxy
  // page) — not worth showing verbatim.
  if (typeof res.status === "number" && res.status >= 500) {
    return SERVER_ERROR_MESSAGE;
  }
  return serverMessage ?? fallback;
}
