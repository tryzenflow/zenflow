import { zodResolver } from "@hookform/resolvers/zod";
import { type SessionFormValues, sessionSchema } from "@zenflow/core";
import { useForm } from "react-hook-form";

/**
 * RN port of `frontend/src/hooks/use-task-form.ts` — same `sessionSchema`
 * (hoisted, unmodified, to `@zenflow/core` for RN migration Phase 5 / issue
 * #20), same React Hook Form + Zod wiring. `react-hook-form` works
 * identically in RN, no adaptation needed beyond the import path.
 */
export function useSessionForm({
  defaultValues,
}: {
  defaultValues: SessionFormValues;
}) {
  return useForm<SessionFormValues>({
    // zod v4's inferred resolver Input (pre-default, e.g. `tags?: string[]`)
    // vs Output (post-default, `tags: string[]`) types don't unify cleanly
    // with react-hook-form 7's generics here — same pre-existing cast the
    // web hook carries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(sessionSchema as any),
    defaultValues,
  });
}
