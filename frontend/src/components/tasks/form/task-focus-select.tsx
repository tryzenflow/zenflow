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
import { TaskFormValues } from "@/utils/tasks";
import { Badge } from "@/components/ui/badge";

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
        <FormItem>
          <FormLabel>Focus</FormLabel>

          <Select
            disabled={loading}
            onValueChange={(value) => field.onChange(+value)}
            value={field.value.toString()}
          >
            <FormControl>
              <SelectTrigger className="w-fit">
                <SelectValue className="line-clamp-1" placeholder="High" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="3">
                <Badge className="size-4 bg-red-500 mr-2" />
                High
              </SelectItem>
              <SelectItem value="2">
                <Badge className="size-4 bg-yellow-500 mr-2" />
                Medium
              </SelectItem>
              <SelectItem value="1">
                <Badge className="size-4 bg-green-500 mr-2" />
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
