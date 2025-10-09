import { apiClient } from './client';
import { API_ENDPOINTS } from './config';
import {
  SchedulingSettings,
  UpdateSchedulingSettingsRequest,
  AutoScheduleRequest,
  AutoScheduleResponse,
  Schedule,
  UpdateTaskSplitRequest,
} from './types';

/**
 * Scheduling Service
 * Handles scheduling operations and settings
 */
export const schedulingService = {
  /**
   * Get all schedules
   */
  async getSchedules(): Promise<Schedule[]> {
    return apiClient.get<Schedule[]>(API_ENDPOINTS.SCHEDULES.LIST);
  },

  /**
   * Update a task split in schedule
   */
  async updateTaskSplit(params: {
    year: number;
    month: number;
    day: number;
    taskId: string;
    splitId: string;
    data: UpdateTaskSplitRequest;
  }): Promise<void> {
    const { year, month, day, taskId, splitId, data } = params;
    return apiClient.put(
      API_ENDPOINTS.SCHEDULES.UPDATE_SPLIT(year, month, day, taskId, splitId),
      data
    );
  },

  /**
   * Delete a task split from schedule
   */
  async deleteTaskSplit(params: {
    year: number;
    month: number;
    day: number;
    taskId: string;
    splitId: string;
  }): Promise<void> {
    const { year, month, day, taskId, splitId } = params;
    return apiClient.delete(
      API_ENDPOINTS.SCHEDULES.DELETE_SPLIT(year, month, day, taskId, splitId)
    );
  },

  /**
   * Get scheduling settings
   */
  async getSettings(): Promise<SchedulingSettings> {
    return apiClient.get<SchedulingSettings>(API_ENDPOINTS.SCHEDULES.GET_SETTINGS);
  },

  /**
   * Update scheduling settings
   */
  async updateSettings(data: UpdateSchedulingSettingsRequest): Promise<SchedulingSettings> {
    return apiClient.put<SchedulingSettings>(
      API_ENDPOINTS.SCHEDULING.UPDATE_SETTINGS,
      data
    );
  },

  /**
   * Auto-schedule tasks
   */
  async autoSchedule(data?: AutoScheduleRequest): Promise<AutoScheduleResponse> {
    return apiClient.post<AutoScheduleResponse>(
      API_ENDPOINTS.SCHEDULING.AUTO_SCHEDULE,
      data || {}
    );
  },

  /**
   * Reschedule all tasks for a specific date
   */
  async rescheduleDay(date: string): Promise<AutoScheduleResponse> {
    return apiClient.post<AutoScheduleResponse>(
      API_ENDPOINTS.SCHEDULING.RESCHEDULE,
      { date }
    );
  },

  /**
   * Reschedule specific tasks
   */
  async rescheduleTasks(taskIds: string[]): Promise<AutoScheduleResponse> {
    return apiClient.post<AutoScheduleResponse>(
      API_ENDPOINTS.SCHEDULING.RESCHEDULE,
      { taskIds }
    );
  },
};

