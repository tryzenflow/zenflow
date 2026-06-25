import { TaskFormValues } from "@/utils/tasks";
import { UseFormReturn } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { TimeInput } from "./time-input";
import { DAILY_HORIZON } from "@/utils/constants";

interface FixedFormProps {
  form: UseFormReturn<TaskFormValues>;
  minTime?: number;
}

/** Compute duration in minutes, wrapping around midnight when end < start. */
function crossMidnightDuration(start: number, end: number): number {
  return end >= start ? end - start : DAILY_HORIZON - start + end;
}

export const FixedForm = ({ form, minTime = 0 }: FixedFormProps) => {
  const fixedStart = form.watch("fixedStart");
  const fixedEnd = form.watch("fixedEnd");

  const isCrossMidnight = fixedEnd < fixedStart;

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
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                form.setValue(
                  "duration",
                  crossMidnightDuration(value, fixedEnd),
                );
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
            <div className="relative">
              <FormLabel>End</FormLabel>
              {isCrossMidnight && (
                <span className="absolute -top-1 left-[1.8rem] rounded-full bg-amber-500 px-1 py-px text-[9px] font-bold leading-none text-white">
                  +1
                </span>
              )}
            </div>
            <TimeInput
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                form.setValue(
                  "duration",
                  crossMidnightDuration(fixedStart, value),
                );
              }}
            />
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
};
