import { TaskFormValues } from "@/utils/tasks";
import { UseFormReturn } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { TimeInput } from "./time-input";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@/utils/constants";

interface FixedFormProps {
  form: UseFormReturn<TaskFormValues>;
  minTime?: number;
}

export const FixedForm = ({ form, minTime = 0 }: FixedFormProps) => {
  const fixedStart = form.watch("fixedStart");
  const fixedEnd = form.watch("fixedEnd");

  return (
    <div className="grid gap-2">
      <FormField
        control={form.control}
        name="fixedStart"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Start</FormLabel>
            <TimeInput
              start={minTime}
              end={fixedEnd - TIME_GRANULARITY}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                form.setValue("duration", fixedEnd - value);
              }}
            />
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="fixedEnd"
        render={({ field }) => (
          <FormItem>
            <FormLabel>End</FormLabel>
            <TimeInput
              start={fixedStart + TIME_GRANULARITY}
              end={DAILY_HORIZON}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                form.setValue("duration", value - fixedStart);
              }}
            />
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
};
