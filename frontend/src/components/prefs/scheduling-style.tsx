import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DaySchedulingStyle } from "@/types/prefs"; // Defined above
import React, { useState } from "react";
import { toast } from "sonner";
import { formatMinutes } from "../../utils/prefs";
import { Button } from "../ui/button";
import { Label } from "../ui/label";

interface SchedulingStyleProps {
  styleData: DaySchedulingStyle;
  setStyleData: React.Dispatch<React.SetStateAction<DaySchedulingStyle>>;
}

export function SchedulingStyle({
  styleData,
  setStyleData,
}: SchedulingStyleProps) {
  const [selectedDay, setSelectedDay] = useState<
    "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
  >("Mon");
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

  const applyToEveryWeekday = () => {
    toast.info("Successfully applied to every day");
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
    <div className="space-y-6">
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
          <div className="flex flex-row gap-x-4 items-center justify-between">
            <div className="space-y-0.5">
              <Label>Batching Similar Tasks</Label>
              <p className="text-sm text-muted-foreground">
                Group related tasks together, so you can stay in the zone
                instead of switching contexts.
              </p>
            </div>

            <Switch
              checked={styleData[selectedDay].batchSimilarTasks}
              onCheckedChange={(val) => {
                setStyleData({
                  ...styleData,
                  [selectedDay]: {
                    ...styleData[selectedDay],
                    batchSimilarTasks: val,
                  },
                });
              }}
            />
          </div>

          <div className="mt-6 flex justify-between">
            <div className="space-y-0.5">
              <Label>
                Maximum Daily Load (
                {formatMinutes(styleData[selectedDay].maxDailyLoad)})
              </Label>
              <p className="text-sm text-muted-foreground">
                Set your daily focus cap. If there's overflow, we'll drop
                optional tasks.
              </p>
            </div>
            <div className="flex items-center gap-4 pt-4">
              <Slider
                min={0}
                max={720} // Limit to 12 hours (720 minutes) for UI sanity
                step={15} // 15-minute increments
                value={[styleData[selectedDay].maxDailyLoad]}
                onValueChange={(val) => {
                  setStyleData({
                    ...styleData,
                    [selectedDay]: {
                      ...styleData[selectedDay],
                      maxDailyLoad: val[0],
                    },
                  });
                }}
                className="min-w-48"
              />
            </div>
          </div>

          {/* 3. Minimum Break Time (Slider) */}
          <div className="mt-6 flex justify-between">
            <div className="space-y-0.5">
              <Label>
                Minimum Break Time (
                {formatMinutes(styleData[selectedDay].minGapBetweenTasks)})
              </Label>
              <p className="text-sm text-muted-foreground">
                Set the minimum break time you want between tasks (if possible).
              </p>
            </div>
            <div className="flex items-center gap-4 pt-4">
              <Slider
                min={0}
                max={120} // Limit to 120 minutes
                step={5} // 5-minute increments
                value={[styleData[selectedDay].minGapBetweenTasks]}
                onValueChange={(val) => {
                  setStyleData({
                    ...styleData,
                    [selectedDay]: {
                      ...styleData[selectedDay],
                      minGapBetweenTasks: val[0],
                    },
                  });
                }}
                className="min-w-48"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Button
        size="sm"
        className="mt-4"
        type="button"
        onClick={applyToEveryWeekday}
        variant="secondary"
      >
        Apply to every day
      </Button>
    </div>
  );
}
