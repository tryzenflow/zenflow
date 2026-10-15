import { isAxiosError } from "axios";
import { toast } from "sonner";
import {
  CalendarClockIcon,
  LayersIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import {
  SCHEDULE_INFEASIBLE_CODE,
  type InfeasiblePolicy,
} from "@zenflow/shared";
import { cn } from "@/lib/utils";

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

/**
 * Title + explanation for each policy — kept in sync with what the engine
 * actually does (`DisplacementService.fallbackStart` /
 * `InfeasiblePolicy` in `@zenflow/shared`): `ACCEPT_CONFLICTS` keeps the
 * deadline and picks the least-conflicting slot before it (fixed events never
 * move, but it can double-book another flexible task); `ACCEPT_LATE_DEADLINE`
 * keeps every slot conflict-free by placing the task in the first free slot
 * after the deadline instead (shown as a "late" block).
 */
const POLICY_COPY: Record<
  InfeasiblePolicy,
  { title: string; description: string; icon: LucideIcon; tint: string }
> = {
  ACCEPT_CONFLICTS: {
    title: "Keep the deadline, allow a conflict",
    description: "It'll overlap another session — nothing fixed gets moved.",
    icon: LayersIcon,
    tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  },
  ACCEPT_LATE_DEADLINE: {
    title: "Push the deadline, stay conflict-free",
    description: "It'll be scheduled a bit later, but won't overlap anything.",
    icon: CalendarClockIcon,
    tint: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
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

/** One clickable, radio-card-style row inside the infeasible-policy toast. */
function PolicyOption({
  policy,
  onChoose,
}: {
  policy: InfeasiblePolicy;
  onChoose: (policy: InfeasiblePolicy) => void;
}) {
  const { title, description, icon: Icon, tint } = POLICY_COPY[policy];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={false}
      onClick={() => onChoose(policy)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-left transition-colors",
        "hover:border-primary/50 hover:bg-primary/10 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          tint,
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-[11.5px] font-normal text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

/**
 * Full content of the infeasible-policy toast. `toast.custom` renders raw
 * JSX — sonner strips its own wrapper bare for it (`[data-styled="false"]`
 * in index.css) — so this draws its own `glass-notice` card, matching the
 * chrome regular toasts get (same icon-disc + title layout as `sonner.tsx`).
 */
function InfeasiblePolicyToast({
  title,
  options,
  onChoose,
}: {
  title: string;
  options: InfeasiblePolicy[];
  onChoose: (policy: InfeasiblePolicy) => void;
}) {
  return (
    <div className="glass-notice flex w-md flex-col gap-3 rounded-2xl px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <TriangleAlertIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <p className="text-[13.5px] leading-snug font-semibold text-foreground">
            {title}
          </p>
          <p className="mt-0.5 text-[11.5px] font-normal text-muted-foreground">
            There's no free time before it's due — pick how to handle it:
          </p>
        </span>
      </div>
      <div role="radiogroup" className="flex flex-col gap-2">
        {options.map((policy) => (
          <PolicyOption key={policy} policy={policy} onChoose={onChoose} />
        ))}
      </div>
    </div>
  );
}

/**
 * Persistent toast with one radio-card option per policy. Resolves with the
 * chosen policy, or `null` if the user dismisses it.
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
    const [title] = message.split("\n");
    const id = toast.custom(
      () => (
        <InfeasiblePolicyToast
          title={title}
          options={options}
          onChoose={(policy) => {
            settle(policy);
            toast.dismiss(id);
          }}
        />
      ),
      {
        id: "schedule-infeasible",
        duration: Infinity,
        onDismiss: () => settle(null),
        onAutoClose: () => settle(null),
      },
    );
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
