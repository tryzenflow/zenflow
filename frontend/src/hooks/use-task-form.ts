import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { taskSchema, TaskFormValues } from "@/utils/tasks"; // Import the schema

interface UseTaskFormProps {
  defaultValues: TaskFormValues;
}

export function useTaskForm({ defaultValues }: UseTaskFormProps) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema as any),
    defaultValues,
  });

  return form;
}
