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
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { CategoryItem, DAILY_HORIZON } from "@/types/prefs";
import { Task } from "@/types/tasks";
import { TaskFormValues } from "@/utils/tasks";
import { addDays } from "date-fns";
import { UseFormReturn } from "react-hook-form";
import { DurationInput } from "../duration-input";
import { NoteEditor } from "../note-editor";
import { PrerequisitesSelect } from "../prerequisites-select";
import { TimeInput } from "../time-input";
import { TaskCategorySelect } from "./task-category-select";
import { TaskFocusSelect } from "./task-focus-select";
import { TaskPrioritySelect } from "./task-priority-select";
import { Switch } from "../../ui/switch";

interface TaskFormProps {
  form: UseFormReturn<TaskFormValues>;
  onSubmit: (values: TaskFormValues) => void;
  onCancel: () => void;
  loading: boolean;
  tasks: Task[];
  categories: CategoryItem[];
}

export function TaskForm({
  form,
  onSubmit,
  onCancel,
  loading,
  tasks,
  categories,
}: TaskFormProps) {
  const maxSplits = form.watch("maxSplits");
  const earliestStart = form.watch("earliestStart");
  const latestEnd = form.watch("latestEnd");
  const duration = form.watch("duration");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Task Name and Date/Duration Row */}
        <div className="flex items-baseline gap-4">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>Task Name</FormLabel>
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

          <FormField
            control={form.control}
            name="scheduleDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Schedule Date</FormLabel>
                <FormControl>
                  <DatePicker
                    disabled={loading || { before: new Date() }}
                    className="w-full"
                    date={field.value}
                    onSelect={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Priority, Focus, and Category Row */}
        <div className="flex gap-4 items-baseline">
          <TaskPrioritySelect formControl={form.control} loading={loading} />
          <TaskFocusSelect formControl={form.control} loading={loading} />
          <TaskCategorySelect
            formControl={form.control}
            loading={loading}
            categories={categories}
          />
        </div>

        {/* Duration / Earliest Start / Latest End Row */}
        <div className="grid grid-cols-3 gap-x-3 items-baseline">
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
          <FormField
            control={form.control}
            name="earliestStart"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Earliest Start</FormLabel>
                <TimeInput
                  disabled={loading}
                  value={field.value || 0}
                  onChange={field.onChange}
                  end={latestEnd ? latestEnd - duration : latestEnd}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="latestEnd"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Latest End</FormLabel>
                <TimeInput
                  disabled={loading}
                  value={field.value || DAILY_HORIZON}
                  onChange={field.onChange}
                  start={
                    earliestStart ? earliestStart + duration : earliestStart
                  }
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Deadline Date and Time */}
        <div className="grid grid-cols-3 gap-4 items-baseline">
          <FormField
            control={form.control}
            name="deadlineDate"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Deadline Date</FormLabel>
                <DatePicker
                  placeholder="Select date"
                  disabled={loading || { before: addDays(new Date(), 1) }}
                  date={field.value}
                  onSelect={field.onChange}
                />
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

        <FormField
          control={form.control}
          name="mandatory"
          render={({ field }) => (
            <FormItem className="flex gap-x-2">
              <Switch
                disabled={loading}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
              <FormLabel>Mandatory</FormLabel>
            </FormItem>
          )}
        />

        <Separator />

        {/* Notes */}
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <NoteEditor
                  disabled={loading}
                  value={field.value || ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Max Splits Slider */}
        <FormField
          control={form.control}
          name="maxSplits"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max Splits</FormLabel>
              <FormControl>
                <Slider
                  min={1}
                  max={10}
                  disabled={loading}
                  step={1}
                  value={[field.value]}
                  onValueChange={(val) => field.onChange(val[0])}
                />
              </FormControl>
              <FormDescription>
                Task will be split into at most{" "}
                <span className="font-medium">{maxSplits} chunks.</span>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Prerequisites */}
        <FormField
          control={form.control}
          name="prerequisites"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Prerequisites</FormLabel>
              <PrerequisitesSelect
                disabled={loading}
                tasks={tasks}
                selected={field.value ?? []}
                onChange={(value) => {
                  const preqIdsSet = new Set(
                    form.getValues("prerequisites") ?? []
                  );
                  if (preqIdsSet.has(value)) preqIdsSet.delete(value);
                  else preqIdsSet.add(value);
                  field.onChange(Array.from(preqIdsSet));
                }}
              />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-2 pt-4">
          <Button
            onClick={onCancel}
            disabled={loading}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={loading} type="submit">
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
