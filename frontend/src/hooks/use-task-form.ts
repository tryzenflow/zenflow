import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { taskSchema, TaskFormValues } from "@/utils/tasks"; // Import the schema

interface UseTaskFormProps {
  defaultValues: TaskFormValues;
}

export function useTaskForm({ defaultValues }: UseTaskFormProps) {
  const form = useForm<TaskFormValues>({
    // zod v4's inferred resolver Input (pre-default, e.g. `tags?: string[]`)
    // vs Output (post-default, `tags: string[]`) types don't unify cleanly
    // with react-hook-form 7's generics here — pre-existing cast, not
    // introduced by this change.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(taskSchema as any),
    defaultValues,
  });

  return form;
}
