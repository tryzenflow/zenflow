import { toast } from "sonner";

/**
 * Error toast with built-in dedupe.
 *
 * When several API requests fail at once (e.g. a burst of 403 "Forbidden
 * resource" responses), each call site would otherwise stack its own identical
 * toast. Deriving sonner's `id` from the message collapses exact duplicates
 * into a single toast — distinct messages still show separately.
 */
export function errorToast(
  message: string,
  options?: Parameters<typeof toast.error>[1],
) {
  return toast.error(message, { id: `error:${message}`, ...options });
}
