import { isAxiosError } from "axios";
import { toast } from "sonner";

/**
 * Error toast with built-in dedupe.
 *
 * When several API requests fail at once (e.g. a burst of 403 "Forbidden
 * resource" responses), each call site would otherwise stack its own identical
 * toast. Deriving sonner's `id` from the title collapses exact duplicates
 * into a single toast — distinct titles still show separately.
 *
 * Every toast is a short `title` plus a `description` with context / the next
 * step (pass it via `options.description`).
 */
export function errorToast(
  title: string,
  options?: Parameters<typeof toast.error>[1],
) {
  return toast.error(title, { id: `error:${title}`, ...options });
}

/** The server's message for an API failure, or `fallback` when there's none. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  return (isAxiosError(error) && error.response?.data?.message) || fallback;
}
