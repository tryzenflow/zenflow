import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/datepicker";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Category, Task } from "@/types/tasks";
import { TaskFormValues } from "@/utils/tasks";
import { format } from "date-fns";
import { UseFormReturn } from "react-hook-form";
import { DurationInput } from "../duration-input";
import { NoteEditor } from "../note-editor";
import { TaskCategorySelect } from "./task-category-select";
import { TaskEnergySelect } from "./task-energy-select";
import { Switch } from "../../ui/switch";
import { RRuleForm } from "../rrule-form";

interface TaskFormProps {
  form: UseFormReturn<TaskFormValues>;
  newUploadsRef?: React.RefObject<string[]>;
  onSubmit: (values: TaskFormValues) => void;
  onCancel: () => void;
  loading: boolean;
  tasks: Task[];
  initialNote?: string;
  categories: Category[];
}

export function TaskForm({
  form,
  onSubmit,
  onCancel,
  newUploadsRef,
  loading,
  categories,
  initialNote,
}: TaskFormProps) {
  const isRecurring = form.watch("isRecurring");

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 w-full md:max-w-7xl mx-auto"
      >
        {/* Top-level responsive grid:
            - Single column on small screens
            - 3 columns at md, with main content spanning 2 cols and sidebar 1 col
        */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main column: important fields (spans 2 cols on md) */}
          <div className="md:col-span-2 h-fit space-y-4">
            {/* Task Name and Schedule Date */}
            <div className="flex flex-col sm:flex-row items-baseline gap-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem className="flex-1 w-full">
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input
                        disabled={loading}
                        placeholder="Do something"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-col sm:flex-row gap-4 items-baseline">
                <TaskEnergySelect
                  formControl={form.control}
                  loading={loading}
                />
                <TaskCategorySelect
                  formControl={form.control}
                  loading={loading}
                  categories={categories}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-baseline">
                <FormField
                  control={form.control}
                  name="duration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration</FormLabel>
                      <DurationInput
                        disabled={loading}
                        value={field.value}
                        onChange={field.onChange}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <NoteEditor
                        initialValue={initialNote}
                        newUploadsRef={newUploadsRef}
                        disabled={loading}
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Sidebar / Advanced config (small column on the right from md) */}
            <div className="md:col-span-1 flex flex-col gap-y-4">
              {/* Deadline Date and Time */}

              <div className="flex items-center space-x-2 w-fit justify-self-end md:order-1 order-last">
                <Button
                  onClick={onCancel}
                  disabled={loading}
                  type="button"
                  variant="outline"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button size="sm" disabled={loading} type="submit">
                  Save
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-4 items-baseline">
                <FormField
                  control={form.control}
                  name="deadlineDate"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Deadline Date</FormLabel>
                      <DatePicker
                        placeholder="Select date"
                        disabled={loading || { before: new Date() }}
                        date={field.value ? new Date(field.value) : undefined}
                        onSelect={(value) => {
                          field.onChange(
                            value ? format(value, "yyyy-MM-dd") : "",
                          );
                        }}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="col-span-1">
                  <FormField
                    control={form.control}
                    name="deadlineTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="invisible">Time</FormLabel>
                        <Input disabled={loading} type="time" {...field} />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Recurring switch */}
              <FormField
                control={form.control}
                name="isRecurring"
                render={({ field }) => (
                  <FormItem className="flex gap-2 items-center">
                    <Switch
                      disabled={loading}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <FormLabel>Recurring</FormLabel>
                  </FormItem>
                )}
              />
              {isRecurring && <RRuleForm form={form} />}
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
