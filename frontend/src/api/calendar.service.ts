import { apiClient } from './client';
import { API_ENDPOINTS } from './config';
import {
  DailySchedule,
  WeeklySchedule,
  MonthlySchedule,
} from './types';

/**
 * Calendar Service
 * Handles calendar and schedule view operations
 */
export const calendarService = {
  /**
   * Get daily schedule
   */
  async getDailySchedule(date: string): Promise<DailySchedule> {
    return apiClient.get<DailySchedule>(API_ENDPOINTS.CALENDAR.DAILY(date));
  },

  /**
   * Get weekly schedule
   */
  async getWeeklySchedule(startDate: string): Promise<WeeklySchedule> {
    return apiClient.get<WeeklySchedule>(API_ENDPOINTS.CALENDAR.WEEKLY(startDate));
  },

  /**
   * Get monthly schedule
   */
  async getMonthlySchedule(year: number, month: number): Promise<MonthlySchedule> {
    return apiClient.get<MonthlySchedule>(
      API_ENDPOINTS.CALENDAR.MONTHLY(year, month)
    );
  },

  /**
   * Get today's schedule
   */
  async getTodaySchedule(): Promise<DailySchedule> {
    const today = new Date().toISOString().split('T')[0];
    return this.getDailySchedule(today);
  },

  /**
   * Get current week schedule
   */
  async getCurrentWeekSchedule(): Promise<WeeklySchedule> {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const startDate = startOfWeek.toISOString().split('T')[0];
    return this.getWeeklySchedule(startDate);
  },

  /**
   * Get current month schedule
   */
  async getCurrentMonthSchedule(): Promise<MonthlySchedule> {
    const today = new Date();
    return this.getMonthlySchedule(today.getFullYear(), today.getMonth() + 1);
  },
};

