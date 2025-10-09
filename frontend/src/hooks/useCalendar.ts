import { useState, useCallback, useEffect } from 'react';
import { calendarService } from '../api';
import type { DailySchedule, WeeklySchedule, MonthlySchedule } from '../api';

/**
 * Daily Schedule Hook
 */
export function useDailySchedule(date: string) {
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = useCallback(async () => {
    if (!date) return;

    setIsLoading(true);
    setError(null);
    try {
      const fetchedSchedule = await calendarService.getDailySchedule(date);
      setSchedule(fetchedSchedule);
      return fetchedSchedule;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch daily schedule';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  return {
    schedule,
    isLoading,
    error,
    refetch: fetchSchedule,
  };
}

/**
 * Weekly Schedule Hook
 */
export function useWeeklySchedule(startDate: string) {
  const [schedule, setSchedule] = useState<WeeklySchedule | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = useCallback(async () => {
    if (!startDate) return;

    setIsLoading(true);
    setError(null);
    try {
      const fetchedSchedule = await calendarService.getWeeklySchedule(startDate);
      setSchedule(fetchedSchedule);
      return fetchedSchedule;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch weekly schedule';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [startDate]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  return {
    schedule,
    isLoading,
    error,
    refetch: fetchSchedule,
  };
}

/**
 * Monthly Schedule Hook
 */
export function useMonthlySchedule(year: number, month: number) {
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = useCallback(async () => {
    if (!year || !month) return;

    setIsLoading(true);
    setError(null);
    try {
      const fetchedSchedule = await calendarService.getMonthlySchedule(year, month);
      setSchedule(fetchedSchedule);
      return fetchedSchedule;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch monthly schedule';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  return {
    schedule,
    isLoading,
    error,
    refetch: fetchSchedule,
  };
}

