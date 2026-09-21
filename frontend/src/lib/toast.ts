import { isAxiosError } from "axios";
import { toast } from "sonner";
import {
  SCHEDULE_INFEASIBLE_CODE,
  type InfeasiblePolicy,
} from "@zenflow/shared";

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

const POLICY_LABEL: Record<InfeasiblePolicy, string> = {
  ACCEPT_CONFLICTS: "Accept conflicts",
  ACCEPT_LATE_DEADLINE: "Accept late deadline",
};

/** The 409 body when a task has no conflict-free slot before its deadline. */
export function infeasibleOptions(error: unknown): InfeasiblePolicy[] | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const body = error.response.data;
  if (body?.code !== SCHEDULE_INFEASIBLE_CODE) return null;
  return Array.isArray(body.options) && body.options.length
    ? body.options
    : ["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"];
}

/**
 * Persistent toast with one action per policy. Resolves with the chosen
 * policy, or `null` if the user dismisses it.
 */
function promptInfeasiblePolicy(
  message: string,
  options: InfeasiblePolicy[],
): Promise<InfeasiblePolicy | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: InfeasiblePolicy | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const [title, ...rest] = message.split("\n");
    const [first, second] = options;
    toast.error(title, {
      id: "schedule-infeasible",
      description: rest.join("\n") || undefined,
      duration: Infinity,
      action: {
        label: POLICY_LABEL[first],
        onClick: () => settle(first),
      },
      cancel: second
        ? { label: POLICY_LABEL[second], onClick: () => settle(second) }
        : undefined,
      onDismiss: () => settle(null),
      onAutoClose: () => settle(null),
    });
  });
}

/**
 * Run a create/update request; on a 409 SCHEDULE_INFEASIBLE (nothing was
 * persisted) ask the user which policy to accept and retry the same request
 * with it. Resolves `null` when the user dismisses the prompt. Other errors
 * are rethrown.
 */
export async function withInfeasibleRetry<T>(
  run: (infeasiblePolicy?: InfeasiblePolicy) => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    const options = infeasibleOptions(error);
    if (!options) throw error;
    const message = apiErrorMessage(
      error,
      "No conflict-free slot before the deadline",
    );
    const policy = await promptInfeasiblePolicy(message, options);
    if (!policy) return null;
    return run(policy);
  }
}

/** Info toast when the engine moved flexible tasks to make room. */
export function notifyDisplaced(res: { displacedSessions?: unknown[] }) {
  const n = res.displacedSessions?.length ?? 0;
  if (!n) return;
  toast.info(`${n} flexible task${n === 1 ? "" : "s"} moved`, {
    description: "They were rescheduled to make room.",
  });
}
