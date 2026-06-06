import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { taskSchema, TaskFormValues, EditTaskFormValues } from "@/utils/tasks"; // Import the schema

interface UseTaskFormProps {
  defaultValues: TaskFormValues | EditTaskFormValues;
}

export function useTaskForm({ defaultValues }: UseTaskFormProps) {
  const form = useForm<TaskFormValues | EditTaskFormValues>({
    resolver: zodResolver(taskSchema as any),
    defaultValues,
  });

  return form;
}
