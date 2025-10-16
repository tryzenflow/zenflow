import { Control } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskFormValues } from "../../../utils/tasks";

interface TaskFocusSelectProps {
  formControl: Control<TaskFormValues>;
  loading: boolean;
}

export function TaskFocusSelect({
  formControl,
  loading,
}: TaskFocusSelectProps) {
  return (
    <FormField
      control={formControl}
      name="focus"
      render={({ field }) => (
        <FormItem className="flex-1">
          <FormLabel>Focus</FormLabel>
          <Select
            onValueChange={(value) => field.onChange(+value)}
            defaultValue={field.value.toString()}
            disabled={loading}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Work" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="3">Deep Work</SelectItem>
              <SelectItem value="2">Work</SelectItem>
              <SelectItem value="1">Personal</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
