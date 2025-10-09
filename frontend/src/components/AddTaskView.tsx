import React, { useState } from 'react';
import { X, ChevronDown, Link2, Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link, Paperclip } from 'lucide-react';
import { Slider } from './ui/slider';

interface AddTaskViewProps {
  onClose: () => void;
  onSave?: (taskData: TaskData) => void;
}

interface TaskData {
  name: string;
  date: string;
  duration: string;
  priority: 'low' | 'high';
  focus: 'low' | 'high';
  category: string;
  earliestStart: string;
  latestEnd: string;
  deadline: string;
  deadlineTime: string;
  notes: string;
  maxSplits: number;
  prerequisites: string[];
  isFixed: boolean;
}

export function AddTaskView({ onClose, onSave }: AddTaskViewProps) {
  const [taskName, setTaskName] = useState('');
  const [date, setDate] = useState('2025-10-09');
  const [duration, setDuration] = useState('3h20m');
  const [priority, setPriority] = useState<'low' | 'high'>('low');
  const [focus, setFocus] = useState<'low' | 'high'>('high');
  const [category, setCategory] = useState('Personal / Home');
  const [earliestStart, setEarliestStart] = useState('8:00AM');
  const [latestEnd, setLatestEnd] = useState('5:00PM');
  const [deadline, setDeadline] = useState('2025-10-12');
  const [deadlineTime, setDeadlineTime] = useState('10:30AM');
  const [notes, setNotes] = useState('');
  const [splits, setSplits] = useState(3);
  const [prerequisites, setPrerequisites] = useState<string[]>([]);
  const [isFixed, setIsFixed] = useState(false);

  const categories = [
    'Personal / Home',
    'Work',
    'Study',
    'Health & Fitness',
    'Shopping',
    'Travel',
    'Other'
  ];

  const durations = [
    '30m', '1h', '1h30m', '2h', '2h30m', '3h', '3h20m', '4h', '5h', '6h', '8h'
  ];

  const timeSlots = [
    '6:00AM', '7:00AM', '8:00AM', '9:00AM', '10:00AM', '11:00AM', '12:00PM',
    '1:00PM', '2:00PM', '3:00PM', '4:00PM', '5:00PM', '6:00PM', '7:00PM', '8:00PM', '9:00PM', '10:00PM'
  ];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const handleSave = () => {
    if (!taskName.trim()) {
      alert('Please enter a task name');
      return;
    }

    const taskData: TaskData = {
      name: taskName,
      date,
      duration,
      priority,
      focus,
      category,
      earliestStart,
      latestEnd,
      deadline,
      deadlineTime,
      notes,
      maxSplits: splits,
      prerequisites,
      isFixed
    };

    onSave?.(taskData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="space-y-3 p-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Your Task Name"
              className="text-base font-semibold text-gray-900 bg-transparent border-none outline-none flex-1"
            />
            <button
              onClick={onClose}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Date & Duration */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-8 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-xs text-gray-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Duration</label>
              <select 
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="h-8 w-full appearance-none rounded-lg border border-gray-300 bg-white px-2.5 pr-7 text-xs text-gray-900"
              >
                {durations.map((dur) => (
                  <option key={dur} value={dur}>{dur}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Priority, Focus, Category */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Priority</label>
              <div className="flex gap-1">
                <button
                  onClick={() => setPriority('low')}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-xs transition ${
                    priority === 'low'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  Low
                </button>
                <button
                  onClick={() => setPriority('high')}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-xs transition ${
                    priority === 'high'
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  High
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Focus</label>
              <div className="flex gap-1">
                <button
                  onClick={() => setFocus('low')}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-xs transition ${
                    focus === 'low'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  Low
                </button>
                <button
                  onClick={() => setFocus('high')}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-xs transition ${
                    focus === 'high'
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  High
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Category</label>
              <select 
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-8 w-full appearance-none rounded-lg border border-gray-300 bg-white px-2.5 pr-7 text-xs text-gray-900"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: Earliest Start & Latest End */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Earliest Start</label>
              <select
                value={earliestStart}
                onChange={(e) => setEarliestStart(e.target.value)}
                className="h-8 w-full rounded-lg border border-gray-300 px-2.5 text-xs text-gray-900"
              >
                {timeSlots.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
            <div className="relative pb-0.5">
              {isFixed && (
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black px-2 py-0.5 text-xs text-white">
                  Make this task fixed
                </div>
              )}
              <button
                onClick={() => setIsFixed(!isFixed)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                  isFixed
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 text-gray-400 hover:border-gray-400'
                }`}
              >
                <Link className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Latest End</label>
              <select
                value={latestEnd}
                onChange={(e) => setLatestEnd(e.target.value)}
                className="h-8 w-full rounded-lg border border-gray-300 px-2.5 text-xs text-gray-900"
              >
                {timeSlots.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 4: Deadline, Notes */}
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Deadline</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="h-8 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-xs text-gray-900"
                />
              </div>
              <div className="space-y-1">
                <label className="invisible text-xs">Time</label>
                <select
                  value={deadlineTime}
                  onChange={(e) => setDeadlineTime(e.target.value)}
                  className="h-8 w-20 rounded-lg border border-gray-300 px-2.5 text-xs text-gray-900"
                >
                  {timeSlots.map((time) => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Notes</label>
              <div className="overflow-hidden rounded-lg border border-gray-300">
                <div className="flex items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-1.5 py-0.5">
                  <button className="rounded p-0.5 hover:bg-gray-200" aria-label="Bold">
                    <Bold className="h-3 w-3 text-gray-600" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-gray-200" aria-label="Italic">
                    <Italic className="h-3 w-3 text-gray-600" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-gray-200" aria-label="Underline">
                    <Underline className="h-3 w-3 text-gray-600" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-gray-200" aria-label="Strikethrough">
                    <Strikethrough className="h-3 w-3 text-gray-600" />
                  </button>
                  <div className="mx-0.5 h-3 w-px bg-gray-300" />
                  <button className="rounded p-0.5 hover:bg-gray-200" aria-label="Bullet list">
                    <List className="h-3 w-3 text-gray-600" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-gray-200" aria-label="Numbered list">
                    <ListOrdered className="h-3 w-3 text-gray-600" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-gray-200" aria-label="Link">
                    <Link2 className="h-3 w-3 text-gray-600" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-gray-200" aria-label="Attachment">
                    <Paperclip className="h-3 w-3 text-gray-600" />
                  </button>
                </div>
                <textarea
                  placeholder="Some notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-16 w-full resize-none border-none px-2.5 py-2 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Row 5: Max Splits, Prerequisites */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Max Splits</label>
              <div className="relative rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                {splits > 1 && (
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black px-2 py-0.5 text-xs text-white">
                    Task will be split into at most {splits} chunks
                  </div>
                )}
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={[splits]}
                  onValueChange={([value]) => setSplits(value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Prerequisites</label>
              <select className="h-8 w-full appearance-none rounded-lg border border-gray-300 bg-white px-2.5 pr-7 text-xs text-gray-900">
                <option>3 tasks selected</option>
              </select>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              className="rounded-lg bg-black px-5 py-1.5 text-xs font-medium text-white hover:bg-black/90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

