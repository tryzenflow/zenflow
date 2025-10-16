import { Control } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TaskFormValues } from "@/utils/tasks";

interface TaskPrioritySelectProps {
  formControl: Control<TaskFormValues>;
  loading: boolean;
}

export function TaskPrioritySelect({
  formControl,
  loading,
}: TaskPrioritySelectProps) {
  return (
    <FormField
      control={formControl}
      name="priority"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Priority</FormLabel>
          <Select
            onValueChange={(value) => field.onChange(+value)}
            value={field.value.toString()}
            disabled={loading}
          >
            <SelectTrigger>
              <SelectValue placeholder={field.value} />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="3">
                <Badge className="size-4 rounded-full bg-red-500 mr-2" />
                High
              </SelectItem>
              <SelectItem value="2">
                <Badge className="size-4 rounded-full bg-yellow-500 mr-2" />
                Medium
              </SelectItem>
              <SelectItem value="1">
                <Badge className="size-4 rounded-full bg-blue-500 mr-2" />
                Low
              </SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
