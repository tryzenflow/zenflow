import { useState, useCallback, useEffect } from 'react';
import { schedulingService } from '../api';
import type {
  SchedulingSettings,
  UpdateSchedulingSettingsRequest,
  AutoScheduleRequest,
  AutoScheduleResponse,
} from '../api';

/**
 * Scheduling Hook
 * Manages scheduling settings and operations
 */
export function useScheduling() {
  const [settings, setSettings] = useState<SchedulingSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedSettings = await schedulingService.getSettings();
      setSettings(fetchedSettings);
      return fetchedSettings;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch scheduling settings';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSettings = useCallback(
    async (data: UpdateSchedulingSettingsRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        const updatedSettings = await schedulingService.updateSettings(data);
        setSettings(updatedSettings);
        return updatedSettings;
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to update scheduling settings';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const autoSchedule = useCallback(async (data?: AutoScheduleRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await schedulingService.autoSchedule(data);
      return result;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to auto-schedule tasks';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const rescheduleDay = useCallback(async (date: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await schedulingService.rescheduleDay(date);
      return result;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to reschedule day';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const rescheduleTasks = useCallback(async (taskIds: string[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await schedulingService.rescheduleTasks(taskIds);
      return result;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to reschedule tasks';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    settings,
    isLoading,
    error,
    fetchSettings,
    updateSettings,
    autoSchedule,
    rescheduleDay,
    rescheduleTasks,
  };
}

