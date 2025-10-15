import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { DaySchedulingStyle, DailyConstraints } from "@/types/prefs"; // Defined above
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { formatMinutes } from "../../utils/prefs";

// --- Zod Schema ---
const constraintSchema = z.object({
  batchSimilarTasks: z.boolean(),
  // MaxDailyLoad: 0 to 1440 minutes (0 to 24 hours)
  maxDailyLoad: z.number().int().min(0).max(1440),
  // MinGapBetweenTasks: 0 to 1440 minutes
  minGapBetweenTasks: z.number().int().min(0).max(1440),
});

interface SchedulingStyleProps {
  initialSchedulingStyle: DaySchedulingStyle;
  onNext: (data: DaySchedulingStyle) => void;
  onBack: () => void;
}

export function SchedulingStyle({
  initialSchedulingStyle,
  onNext,
}: SchedulingStyleProps) {
  const [styleData, setStyleData] = useState<DaySchedulingStyle>(
    initialSchedulingStyle
  );
  const [selectedDay, setSelectedDay] = useState<
    "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
  >("Mon");
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

  const form = useForm<DailyConstraints>({
    resolver: zodResolver(constraintSchema),
    defaultValues: styleData[selectedDay],
  });

  // Watch for changes in the form and update the global state
  const currentConstraints = form.watch();

  React.useEffect(() => {
    // Update form values when the selected day changes
    form.reset(styleData[selectedDay]);
  }, [selectedDay, styleData, form]);

  const handleFormChange = (newConstraints: DailyConstraints) => {
    setStyleData((prev) => ({
      ...prev,
      [selectedDay]: newConstraints,
    }));
  };

  const onSubmit = (data: DailyConstraints) => {
    // Ensure the last-edited day is saved before submitting
    const finalData = { ...styleData, [selectedDay]: data };
    onNext(finalData); // This triggers the final API submission in PreferencePage
  };

  const applyToEveryWeekday = () => {
    toast.info("Successfully applied to every weekday");
    setStyleData((prev) => ({
      Mon: prev[selectedDay],
      Tue: prev[selectedDay],
      Wed: prev[selectedDay],
      Thu: prev[selectedDay],
      Fri: prev[selectedDay],
      Sat: prev[selectedDay],
      Sun: prev[selectedDay],
    }));
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <h2 className="text-2xl font-bold mb-1">
          Customize your scheduling style
        </h2>
        <p className="text-muted-foreground mb-6">
          Fine-tune how your day is planned — from grouping tasks to managing
          focus time and breathing room.
        </p>

        <Tabs
          value={selectedDay}
          onValueChange={(value) => setSelectedDay(value as typeof selectedDay)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-7 mb-6">
            {days.map((day) => (
              <TabsTrigger key={day} value={day}>
                {day}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* The TabsContent structure is simplified because we dynamically update the form based on selectedDay */}
          <TabsContent value={selectedDay}>
            {/* 1. Batching Similar Tasks (Switch) */}
            <FormField
              control={form.control}
              name="batchSimilarTasks"
              render={({ field }) => (
                <FormItem className="flex flex-row gap-x-4 items-center justify-between">
                  <div className="space-y-0.5">
                    <FormLabel>Batching Similar Tasks</FormLabel>
                    <FormDescription>
                      Group related tasks together, so you can stay in the zone
                      instead of switching contexts.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={(val) => {
                        field.onChange(val);
                        handleFormChange({
                          ...currentConstraints,
                          batchSimilarTasks: val,
                        });
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 2. Maximum Daily Load (Slider) */}
            <FormField
              control={form.control}
              name="maxDailyLoad"
              render={({ field }) => (
                <FormItem className="mt-6 flex justify-between">
                  <div className="space-y-0.5">
                    <FormLabel>
                      Maximum Daily Load ({formatMinutes(field.value)})
                    </FormLabel>
                    <FormDescription>
                      Set your daily focus cap. If there's overflow, we'll drop
                      optional tasks.
                    </FormDescription>
                  </div>
                  <div className="flex items-center gap-4 pt-4">
                    <Controller
                      name="maxDailyLoad"
                      control={form.control}
                      render={({ field: sliderField }) => (
                        <Slider
                          min={0}
                          max={720} // Limit to 12 hours (720 minutes) for UI sanity
                          step={15} // 15-minute increments
                          value={[sliderField.value]}
                          onValueChange={(val) => {
                            sliderField.onChange(val[0]);
                            handleFormChange({
                              ...currentConstraints,
                              maxDailyLoad: val[0],
                            });
                          }}
                          className="min-w-48"
                        />
                      )}
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 3. Minimum Break Time (Slider) */}
            <FormField
              control={form.control}
              name="minGapBetweenTasks"
              render={({ field }) => (
                <FormItem className="mt-6 flex justify-between">
                  <div className="space-y-0.5">
                    <FormLabel>
                      Minimum Break Time ({formatMinutes(field.value)})
                    </FormLabel>
                    <FormDescription>
                      Set the minimum break time you want between tasks (if
                      possible).
                    </FormDescription>
                  </div>
                  <div className="flex items-center gap-4 pt-4">
                    <Controller
                      name="minGapBetweenTasks"
                      control={form.control}
                      render={({ field: sliderField }) => (
                        <Slider
                          min={0}
                          max={60} // Limit to 60 minutes
                          step={5} // 5-minute increments
                          value={[sliderField.value]}
                          onValueChange={(val) => {
                            sliderField.onChange(val[0]);
                            handleFormChange({
                              ...currentConstraints,
                              minGapBetweenTasks: val[0],
                            });
                          }}
                          className="min-w-48"
                        />
                      )}
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>
        </Tabs>

        <Button
          size="sm"
          className="mt-4"
          type="button"
          onClick={applyToEveryWeekday}
          variant="secondary"
        >
          Apply to every weekday
        </Button>
      </form>
    </Form>
  );
}
