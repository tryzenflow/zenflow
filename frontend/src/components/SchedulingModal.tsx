import React, { useState } from 'react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Slider } from './ui/slider';

interface SchedulingModalProps {
  onClose: () => void;
}

const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SchedulingModal({ onClose }: SchedulingModalProps) {
  const [selectedDay, setSelectedDay] = useState('Mon');
  const [batchSimilarTasks, setBatchSimilarTasks] = useState(true);
  const [maxDailyLoad, setMaxDailyLoad] = useState(8.5);
  const [minBreakTime, setMinBreakTime] = useState(20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xl rounded-[20px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="space-y-6 px-8 py-8">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900">Customize your scheduling style</h2>
            <p className="mt-1 text-sm text-gray-500">
              Fine-tune how your day is planned — from grouping tasks to managing focus time and breathing room.
            </p>
          </div>

          <div className="flex justify-center gap-2">
            {daysOfWeek.map((day) => (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  selectedDay === day
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {day}
              </button>
            ))}
          </div>

          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900">Batching Similar Tasks</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Group related tasks together, so you can stay in the zone instead of switching contexts.
                </p>
              </div>
              <Switch checked={batchSimilarTasks} onCheckedChange={setBatchSimilarTasks} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Maximum Daily Load</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Set your daily focus cap. If there's overflow, we'll drop optional tasks.
                  </p>
                </div>
                <div className="rounded-lg bg-black px-3 py-1 text-xs font-medium text-white">
                  {maxDailyLoad} hours 30 minutes
                </div>
              </div>
              <Slider
                min={4}
                max={12}
                step={0.5}
                value={[maxDailyLoad]}
                onValueChange={([value]) => setMaxDailyLoad(value)}
                className="w-full"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Minimum Break Time</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Set the minimum break time you want between tasks (if possible).
                  </p>
                </div>
                <div className="rounded-lg bg-black px-3 py-1 text-xs font-medium text-white">
                  {minBreakTime} minutes
                </div>
              </div>
              <Slider
                min={5}
                max={60}
                step={5}
                value={[minBreakTime]}
                onValueChange={([value]) => setMinBreakTime(value)}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-gray-200 pt-6">
            <button className="text-sm text-gray-600 hover:text-gray-900">
              Apply to every weekday
            </button>
            <Button
              className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-black/90"
              onClick={onClose}
            >
              Finish setup
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

