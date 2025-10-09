import React, { useEffect, useMemo, useState } from 'react';
import { Task } from './ui';
import { Calendar } from './ui/calendar';
import { apiClient } from '../api/client';
import { API_ENDPOINTS } from '../api/config';
import type { Task as ApiTask } from '../api/types';

interface DailyViewProps {
  onNavigate?: (view: 'tasks' | 'add-task' | 'categories' | 'focus-blocks' | 'scheduling') => void;
}

export function DailyView({ onNavigate }: DailyViewProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const addDays = (d: Date, days: number) => {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + days);
    return nd;
  };

  const fetchTasks = async (date: Date) => {
    setLoading(true);
    setError(null);
    try {
      const start = formatDate(date);
      const end = formatDate(addDays(date, 1));
      const res = await apiClient.get<any>(`${API_ENDPOINTS.TASKS.LIST}?start=${start}&end=${end}`);
      const data: ApiTask[] = Array.isArray(res) ? res : res?.data ?? [];
      setTasks(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load tasks');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate.toDateString()]);

  // Group scheduled tasks by hour using first schedule segment
  const tasksByHour = useMemo(() => {
    const map: Record<number, ApiTask[]> = {};
    for (let h = 0; h < 24; h++) map[h] = [];
    tasks
      .filter((t) => t.status === 'scheduled' && t.schedules && t.schedules.length > 0)
      .forEach((t) => {
        const seg = t.schedules![0];
        const [hh, mm] = (seg.startTime || '00:00').split(':').map((x) => parseInt(x, 10));
        const hour = isNaN(hh) ? 0 : hh;
        map[hour].push(t);
      });
    return map;
  }, [tasks]);

  const dropoutTasks = useMemo(() => tasks.filter((t) => t.status === 'dropout'), [tasks]);
  const unscheduledTasks = useMemo(() => tasks.filter((t) => t.status === 'unscheduled'), [tasks]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const labelForHour = (h: number) => {
    if (h === 0) return '12AM';
    if (h < 12) return `${h}AM`;
    if (h === 12) return '12PM';
    return `${h - 12}PM`;
  };

  const firstScheduleTime = (t: ApiTask) => {
    if (!t.schedules || t.schedules.length === 0) return '';
    const seg = t.schedules[0];
    const [hh, mm] = (seg.startTime || '00:00').split(':');
    const h = parseInt(hh || '0', 10);
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${mm}${suffix}`;
  };

  return (
    <div className="flex min-h-[720px] flex-col rounded-[32px] bg-white shadow-modal">
      <div className="flex flex-1">
        <div className="flex-1 border-r border-gray-200">
          <div className="grid grid-rows-24">
            {hours.map((h) => (
              <div key={h} className="relative border-b border-gray-100 px-8 py-4 text-xs text-gray-400">
                {labelForHour(h)}
                <div className="absolute inset-y-0 left-24 flex h-full items-center gap-3">
                  {loading && h === hours[0] && (
                    <span className="text-gray-400">Loading...</span>
                  )}
                  {error && h === hours[0] && (
                    <span className="text-red-500">{error}</span>
                  )}
                  {!loading && tasksByHour[h]?.map((t) => (
                    <Task
                      key={t.id}
                      time={firstScheduleTime(t)}
                      title={t.title}
                      color="green"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="w-[320px] space-y-6 px-8 py-8">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(d: Date | undefined) => d && setSelectedDate(d)}
            className="rounded-md"
          />
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
              <span>Dropout Tasks</span>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">{dropoutTasks.length}</span>
            </div>
            <div className="space-y-3 text-sm text-gray-600">
              {dropoutTasks.length === 0 ? (
                <div className="text-xs text-gray-400">No dropout tasks</div>
              ) : (
                dropoutTasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div>{t.title}</div>
                      <div className="text-xs text-gray-400">{t.duration} minutes</div>
                    </div>
                    <span className="text-gray-400">✕</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
              <span>Unscheduled Tasks</span>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-300 text-[10px] text-gray-700">{unscheduledTasks.length}</span>
            </div>
            <div className="space-y-3 text-sm text-gray-600">
              {unscheduledTasks.length === 0 ? (
                <div className="text-xs text-gray-400">No unscheduled tasks</div>
              ) : (
                unscheduledTasks.map((t) => (
                  <label key={t.id} className="flex items-center gap-3">
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                    <div>
                      <div>{t.title}</div>
                      <div className="text-xs text-gray-400">{t.duration} minutes</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
          {/* Optional message area if needed in the future */}
        </div>
      </div>
    </div>
  );
}

