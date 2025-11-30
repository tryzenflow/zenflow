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
import { CategoryItem } from "@/types/prefs";
import { TaskFormValues } from "@/utils/tasks";

interface TaskCategorySelectProps {
  formControl: Control<TaskFormValues>;
  loading: boolean;
  categories: CategoryItem[];
}

export function TaskCategorySelect({
  formControl,
  loading,
  categories,
}: TaskCategorySelectProps) {
  return (
    <FormField
      control={formControl}
      name="categoryId"
      render={({ field }) => (
        <FormItem className="flex-1 w-full">
          <FormLabel>Category</FormLabel>
          <Select
            onValueChange={field.onChange}
            value={field.value}
            disabled={loading || categories.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No category selected" />
            </SelectTrigger>

            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
              {categories.length === 0 && (
                <div className="p-2 text-sm text-center text-muted-foreground">
                  No categories found.
                </div>
              )}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
