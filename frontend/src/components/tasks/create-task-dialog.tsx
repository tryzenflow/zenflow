import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { taskSchema, TaskFormValues } from "@/utils/tasks"; // Import the schema
import { NoteEditor } from "./note-editor";
import { addDays, format } from "date-fns";
import { getData, postData } from "../../api";
import { Badge } from "../ui/badge";
import { useEffect, useMemo, useState } from "react";
import { CategoryItem, DAILY_HORIZON } from "../../types/prefs";
import { DurationInput } from "./duration-input";
import { DatePicker } from "../ui/datepicker";
import { TimeInput } from "./time-input";
import { Task } from "../../types/tasks";
import { PrerequisitesSelect } from "./prerequisites-select";
import { toast } from "sonner";
import { Link2 } from "lucide-react";

export function CreateTaskDialog() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: "",
      duration: 60,
      priority: 2,
      focus: 2,
      maxSplits: 1,
      scheduleDate: new Date(),
      note: "",
    },
  });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [categories, setCategories] = useState<CategoryItem[]>([]);

  async function onSubmit(values: TaskFormValues) {
    let deadline = undefined;
    if (values.deadlineDate && values.deadlineTime) {
      deadline = `${format(values.deadlineDate, "yyyy-MM-dd")}T${
        values.deadlineTime
      }:00.000Z`;
    }

    const payload = { ...values };
    // @ts-ignore
    payload.deadline = deadline;
    // @ts-ignore
    payload.scheduleDate = format(values.scheduleDate, "yyyy-MM-dd");

    delete payload.deadlineTime;
    delete payload.deadlineDate;
    setLoading(true);
    try {
      await postData("/tasks", payload);
      form.reset();
      toast.success("Create task successfully");
      setOpen(false);
    } catch (error: any) {
      toast.error(
        error.message || "Something went wrong when creating a new task"
      );
    } finally {
      setLoading(false);
    }
  }
  const scheduleDate = form.watch("scheduleDate");

  useEffect(() => {
    if (!open) return;
    getData<CategoryItem[]>("/categories").then((data) => {
      setCategories(data);
    });
  }, [open]);

  useEffect(() => {
    if (!scheduleDate || !open) return;
    const nextDay = format(addDays(scheduleDate, 1), "yyyy-MM-dd");
    getData<{ data: Task[] }>(
      `/tasks?start=${format(scheduleDate, "yyyy-MM-dd")}&end=${nextDay}`
    ).then(({ data }) => setTasks(data));
  }, [scheduleDate, open]);

  const categoryMap = useMemo(() => {
    return new Map(categories.map((c) => [c.id, c.name]));
  }, [categories]);

  const maxSplits = form.watch("maxSplits");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Add task</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] overflow-x-hidden md:max-w-[600px] overflow-y-auto max-h-[90vh]">
        <DialogHeader className="space-y-0">
          <DialogTitle>Create new task</DialogTitle>
        </DialogHeader>
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
              {/* Priority Field (Select) */}
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(+value)}
                      defaultValue={field.value.toString()}
                      disabled={loading}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Low" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="1">
                          <Badge className="size-4 rounded-full bg-red-500 mr-2" />
                          High
                        </SelectItem>
                        <SelectItem value="2">
                          <Badge className="size-4 rounded-full bg-yellow-500 mr-2" />
                          Medium
                        </SelectItem>
                        <SelectItem value="3">
                          <Badge className="size-4 rounded-full bg-blue-500 mr-2" />
                          Low
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* Focus Field (Select) */}
              <FormField
                control={form.control}
                name="focus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Focus</FormLabel>
                    <Select
                      disabled={loading}
                      onValueChange={(value) => field.onChange(+value)}
                      defaultValue={field.value.toString()}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue
                            className="line-clamp-1"
                            placeholder="High"
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="1">
                          <Badge className="size-4 bg-red-500 mr-2" />
                          High
                        </SelectItem>
                        <SelectItem value="2">
                          <Badge className="size-4 bg-yellow-500 mr-2" />
                          Medium
                        </SelectItem>
                        <SelectItem value="3">
                          <Badge className="size-4 bg-green-500 mr-2" />
                          Low
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* Category Field (Select) */}
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Category</FormLabel>
                    <Select
                      disabled={loading}
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full line-clamp-1">
                          <SelectValue
                            placeholder={
                              field.value
                                ? categoryMap.get(field.value)
                                : "Select category"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem value={c.id} key={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Earliest Start / Latest End Row */}
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
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4 items-baseline">
              <FormField
                control={form.control}
                name="deadlineDate"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Deadline</FormLabel>
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
                    <FormItem className="col-span-2">
                      <FormLabel>Time {field.value}</FormLabel>{" "}
                      <Input disabled={loading} type="time" {...field} />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

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
                    onChange={(value) =>
                      field.onChange([
                        ...(form.getValues("prerequisites") ?? []),
                        value,
                      ])
                    }
                  />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2 pt-4">
              <Button
                onClick={() => {
                  form.reset();
                  setOpen(false);
                }}
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
      </DialogContent>
    </Dialog>
  );
}
