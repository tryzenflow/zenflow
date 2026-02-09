import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/datepicker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Category } from "@/types/tasks";
import { TaskFormValues } from "@/utils/tasks";
import { format, isToday } from "date-fns";
import { UseFormReturn } from "react-hook-form";
import { DurationInput } from "../duration-input";
import { NoteEditor } from "../note-editor";
import { TaskCategorySelect } from "./task-category-select";
import { TaskEnergySelect } from "./task-energy-select";
import { Switch } from "../../ui/switch";
import { RRuleForm } from "../rrule-form";
import { Label } from "@/components/ui/label";
import { FixedForm } from "../fixed-form";
import { snapToNearestLaterQuarterHour } from "@/utils/time";

interface TaskFormProps {
  form: UseFormReturn<TaskFormValues>;
  newUploadsRef?: React.RefObject<string[]>;
  onSubmit: (values: TaskFormValues) => void;
  onCancel: () => void;
  loading: boolean;
  scheduleDate?: Date;
  onScheduleDateChange?: (date?: Date) => void;
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
  scheduleDate,
  onScheduleDateChange,
}: TaskFormProps) {
  const isRecurring = form.watch("isRecurring");
  const isFixed = form.watch("isFixed");
  const fixedStart = form.watch("fixedStart");
  const fixedEnd = form.watch("fixedEnd");

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 w-full md:max-w-7xl mx-auto"
      >
        <div className="grid gap-6">
          <div className="h-fit space-y-4">
            <div className="flex flex-col items-baseline gap-4">
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

                {scheduleDate && (
                  <div className="w-full sm:w-48">
                    <Label>Date</Label>
                    <DatePicker
                      disabled={loading || { before: new Date() }}
                      className="w-full"
                      date={scheduleDate}
                      onSelect={onScheduleDateChange ?? (() => {})}
                    />
                  </div>
                )}
              </div>

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

              <div className="flex gap-4 items-baseline">
                <FormField
                  control={form.control}
                  name="duration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration</FormLabel>
                      <DurationInput
                        disabled={loading || isFixed}
                        value={isFixed ? fixedEnd - fixedStart : field.value}
                        onChange={field.onChange}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex flex-col gap-y-4">
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
                            date={
                              field.value ? new Date(field.value) : undefined
                            }
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
                </div>
              </div>
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem className="w-full">
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

              {/* Fixed switch */}
              <FormField
                control={form.control}
                name="isFixed"
                render={({ field }) => (
                  <FormItem className="flex gap-2 items-center">
                    <Switch
                      disabled={loading}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <FormLabel>Fixed</FormLabel>
                  </FormItem>
                )}
              />
              {isFixed && (
                <FixedForm
                  minTime={
                    scheduleDate && isToday(scheduleDate)
                      ? snapToNearestLaterQuarterHour(
                          scheduleDate.getHours() * 60 +
                            scheduleDate.getMinutes(),
                        )
                      : 0
                  }
                  form={form}
                />
              )}

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
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
