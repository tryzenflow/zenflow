import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { taskSchema, TaskFormValues } from "@/utils/tasks"; // Import the schema

interface UseCreateTaskFormProps {
  defaultValues: TaskFormValues;
}

export function useCreateTaskForm({ defaultValues }: UseCreateTaskFormProps) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema as any),
    defaultValues,
  });

  const scheduleDate = form.watch("scheduleDate");
  const maxSplits = form.watch("maxSplits");

  return {
    form,
    scheduleDate,
    maxSplits,
  };
}
