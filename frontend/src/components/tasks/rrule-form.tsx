import { useForm, UseFormReturn } from "react-hook-form";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar as DatePicker } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateRRule, TaskFormValues } from "@/utils/tasks";

interface RRuleFormProps {
  form: UseFormReturn<TaskFormValues>;
}

const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const ORDINALS = ["1st", "2nd", "3rd", "4th", "Last"];

const formatDate = (date) => {
  if (!date) return "Pick date";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
};

export function RRuleForm({ form }: RRuleFormProps) {
  const frequency = form.watch("frequency");

  const toggleWeekday = (day) => {
    const current = form.getValues("byweekday");
    form.setValue(
      "byweekday",
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day],
    );
  };

  const freqLabels = {
    YEARLY: "year(s)",
    MONTHLY: "month(s)",
    WEEKLY: "week(s)",
    DAILY: "day(s)",
    HOURLY: "hour(s)",
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <FormField
          control={form.control}
          name="frequency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Repeat</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="YEARLY">Yearly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="DAILY">Daily</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="interval"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Every</FormLabel>
              <div className="flex gap-1.5">
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    {...field}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value) || 1)
                    }
                    className="h-8 w-14 text-sm"
                  />
                </FormControl>
                <span className="text-sm text-muted-foreground self-center">
                  {freqLabels[frequency]}
                </span>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {frequency === "WEEKLY" && (
        <FormField
          control={form.control}
          name="byweekday"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="">Days</FormLabel>
              <FormControl>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day, idx) => (
                    <Button
                      key={day}
                      type="button"
                      variant={
                        field.value.includes(day) ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => toggleWeekday(day)}
                      className="flex-1"
                    >
                      {DAY_NAMES[idx]}
                    </Button>
                  ))}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {frequency === "MONTHLY" && (
        <FormField
          control={form.control}
          name="monthlyMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="">Recurrence</FormLabel>
              <Tabs value={field.value} onValueChange={field.onChange}>
                <TabsList className="grid w-full grid-cols-2 h-8">
                  <TabsTrigger value="on" className=" py-0">
                    Day
                  </TabsTrigger>
                  <TabsTrigger value="on_the" className=" py-0">
                    Position
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="on" className="mt-2">
                  <FormField
                    control={form.control}
                    name="bymonthday"
                    render={({ field }) => (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          Day
                        </span>

                        <Select
                          value={field.value.toString()}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 31 }).map((_, index) => (
                              <SelectItem
                                key={index}
                                value={(index + 1).toString()}
                              >
                                {index + 1}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  />
                </TabsContent>
                <TabsContent value="on_the" className="mt-2">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      On the
                    </span>
                    <div className="flex gap-2">
                      <FormField
                        control={form.control}
                        name="bysetpos"
                        render={({ field }) => (
                          <Select
                            onValueChange={(v) => field.onChange(parseInt(v))}
                            value={field.value.toString()}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ORDINALS.map((ord, idx) => (
                                <SelectItem
                                  key={idx}
                                  value={(idx === 4 ? -1 : idx + 1).toString()}
                                >
                                  {ord}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="byweekdayMonth"
                        render={({ field }) => (
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DAY_NAMES.map((day, idx) => (
                                <SelectItem key={idx} value={DAYS[idx]}>
                                  {day}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {frequency === "YEARLY" && (
        <>
          <FormField
            control={form.control}
            name="month"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="">Month</FormLabel>
                <Select
                  onValueChange={(v) => field.onChange(parseInt(v))}
                  value={field.value.toString()}
                >
                  <FormControl>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MONTHS.map((m, idx) => (
                      <SelectItem key={idx} value={(idx + 1).toString()}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="yearlyMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="">Recurrence</FormLabel>
                <Tabs value={field.value} onValueChange={field.onChange}>
                  <TabsList className="grid w-full grid-cols-2 h-8">
                    <TabsTrigger value="on" className=" py-0">
                      Day
                    </TabsTrigger>
                    <TabsTrigger value="on_the" className=" py-0">
                      Position
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="on" className="mt-2">
                    <FormField
                      control={form.control}
                      name="bymonthday"
                      render={({ field }) => (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            Day
                          </span>
                          <Select
                            value={field.value.toString()}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger size="sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 31 }).map((_, index) => (
                                <SelectItem
                                  key={index}
                                  value={(index + 1).toString()}
                                >
                                  {index + 1}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />
                  </TabsContent>
                  <TabsContent value="on_the" className="mt-2">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        On the
                      </span>
                      <div className="flex gap-2">
                        <FormField
                          control={form.control}
                          name="bysetpos"
                          render={({ field }) => (
                            <Select
                              onValueChange={(v) => field.onChange(parseInt(v))}
                              value={field.value.toString()}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ORDINALS.map((ord, idx) => (
                                  <SelectItem
                                    key={idx}
                                    value={(idx === 4
                                      ? -1
                                      : idx + 1
                                    ).toString()}
                                  >
                                    {ord}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="byweekdayMonth"
                          render={({ field }) => (
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DAY_NAMES.map((day, idx) => (
                                  <SelectItem key={idx} value={DAYS[idx]}>
                                    {day}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}

      <FormField
        control={form.control}
        name="endMode"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="">End</FormLabel>
            <Tabs value={field.value} onValueChange={field.onChange}>
              <TabsList className="grid w-full grid-cols-3 h-8">
                <TabsTrigger value="never" className=" py-0">
                  Never
                </TabsTrigger>
                <TabsTrigger value="after" className=" py-0">
                  After
                </TabsTrigger>
                <TabsTrigger value="on" className=" py-0">
                  Date
                </TabsTrigger>
              </TabsList>
              <TabsContent value="never" className="mt-2">
                <p className="text-sm text-muted-foreground">
                  Repeats indefinitely
                </p>
              </TabsContent>
              <TabsContent value="after" className="mt-2">
                <FormField
                  control={form.control}
                  name="count"
                  render={({ field }) => (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 1)
                        }
                        className="text-sm w-fit"
                      />
                      <span className="shrink-0 text-sm text-muted-foreground">
                        times
                      </span>
                    </div>
                  )}
                />
              </TabsContent>
              <TabsContent value="on" className="mt-2">
                <FormField
                  control={form.control}
                  name="until"
                  render={({ field }) => (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                        >
                          {formatDate(field.value)}
                          <Calendar className="ml-auto h-3 w-3 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <DatePicker
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                />
              </TabsContent>
            </Tabs>
            <FormMessage />
          </FormItem>
        )}
      />
      <Button
        type="button"
        onClick={() => alert(generateRRule(form.getValues()))}
        className="w-full"
      >
        Generate Rule
      </Button>
    </div>
  );
}
