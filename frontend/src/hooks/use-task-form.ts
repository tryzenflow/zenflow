import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type SessionFormValues, sessionSchema } from "@zenflow/core";

interface UseSessionFormProps {
  defaultValues: SessionFormValues;
}

export function useSessionForm({ defaultValues }: UseSessionFormProps) {
  const form = useForm<SessionFormValues>({
    // zod v4's inferred resolver Input (pre-default, e.g. `tags?: string[]`)
    // vs Output (post-default, `tags: string[]`) types don't unify cleanly
    // with react-hook-form 7's generics here — pre-existing cast, not
    // introduced by this change.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(sessionSchema as any),
    defaultValues,
  });

  return form;
}
