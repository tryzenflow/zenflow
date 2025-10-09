import React, { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from './ui/button';

interface FocusBlocksModalProps {
  onClose: () => void;
}

const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function FocusBlocksModal({ onClose }: FocusBlocksModalProps) {
  const [selectedDay, setSelectedDay] = useState('Mon');
  const [isEarlyBird, setIsEarlyBird] = useState(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xl rounded-[20px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="space-y-6 px-8 py-8">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900">Customize focus blocks</h2>
            <p className="mt-1 text-sm text-gray-500">
              Night owl or early bird? Customize your focus blocks to match when you're at your best.
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

          <div className="flex justify-center gap-4">
            <button
              onClick={() => setIsEarlyBird(true)}
              className={`flex items-center gap-2 rounded-xl border-2 px-6 py-3 transition ${
                isEarlyBird
                  ? 'border-yellow-400 bg-yellow-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <Sun className="h-5 w-5 text-yellow-500" />
              <span className="text-sm font-medium text-gray-900">Early bird</span>
            </button>
            <button
              onClick={() => setIsEarlyBird(false)}
              className={`flex items-center gap-2 rounded-xl border-2 px-6 py-3 transition ${
                !isEarlyBird
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <Moon className="h-5 w-5 text-blue-500" />
              <span className="text-sm font-medium text-gray-900">Night owl</span>
            </button>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="rounded-lg bg-black px-3 py-1 text-xs font-medium text-white">
                9AM - 11AM
              </div>
              <button className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-600">
                Change focus level
              </button>
            </div>

            <div className="space-y-4">
              <div className="relative h-32">
                <div className="absolute left-0 right-0 top-8 flex gap-1">
                  <div className="h-12 flex-1 rounded-lg bg-red-500" />
                  <div className="h-12 flex-1 rounded-lg bg-yellow-500" />
                  <div className="h-12 flex-1 rounded-lg bg-green-500" />
                  <div className="h-12 flex-1 rounded-lg bg-green-400" />
                  <div className="h-12 flex-1 rounded-lg bg-gray-200" />
                  <div className="h-12 flex-1 rounded-lg bg-gray-200" />
                  <div className="h-12 flex-1 rounded-lg bg-gray-200" />
                  <div className="h-12 flex-1 rounded-lg bg-gray-200" />
                  <div className="h-12 flex-1 rounded-lg bg-gray-200" />
                  <div className="h-12 flex-1 rounded-lg bg-gray-200" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-gray-400">
                  <span>5AM</span>
                  <span>6AM</span>
                  <span>7AM</span>
                  <span>8AM</span>
                  <span>9AM</span>
                  <span>10AM</span>
                  <span>11AM</span>
                  <span>12PM</span>
                  <span>1PM</span>
                  <span>2PM</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-red-500" />
                  <span className="text-gray-600">High</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-yellow-500" />
                  <span className="text-gray-600">Medium</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-green-500" />
                  <span className="text-gray-600">Low</span>
                </div>
              </div>

              <p className="text-center text-xs text-gray-500">
                No energy assigned? We'll try to keep those hours free from tasks.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button className="text-sm text-gray-600 hover:text-gray-900">
              Apply to every weekday
            </button>
            <Button
              className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-black/90"
              onClick={onClose}
            >
              I'm fine with this
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

