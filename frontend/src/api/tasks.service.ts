import { apiClient } from './client';
import { API_ENDPOINTS } from './config';
import {
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
  TaskListResponse,
  PaginationParams,
} from './types';

/**
 * Tasks Service
 * Handles all task-related operations
 */
export const tasksService = {
  /**
   * Get all tasks with pagination
   */
  async getTasks(params?: PaginationParams): Promise<TaskListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.pageSize) queryParams.append('pageSize', params.pageSize.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const endpoint = `${API_ENDPOINTS.TASKS.LIST}${queryParams.toString() ? `?${queryParams}` : ''}`;
    return apiClient.get<TaskListResponse>(endpoint);
  },

  /**
   * Get tasks by date
   */
  async getTasksByDate(date: string): Promise<Task[]> {
    return apiClient.get<Task[]>(API_ENDPOINTS.TASKS.BY_DATE(date));
  },

  /**
   * Get a single task by ID
   */
  async getTask(id: string): Promise<Task> {
    return apiClient.get<Task>(API_ENDPOINTS.TASKS.GET(id));
  },

  /**
   * Create a new task
   */
  async createTask(data: CreateTaskRequest): Promise<Task> {
    return apiClient.post<Task>(API_ENDPOINTS.TASKS.CREATE, data);
  },

  /**
   * Update an existing task
   */
  async updateTask(id: string, data: UpdateTaskRequest): Promise<Task> {
    return apiClient.put<Task>(API_ENDPOINTS.TASKS.UPDATE(id), data);
  },

  /**
   * Delete a task
   */
  async deleteTask(id: string): Promise<void> {
    return apiClient.delete<void>(API_ENDPOINTS.TASKS.DELETE(id));
  },

  /**
   * Get scheduled tasks
   */
  async getScheduledTasks(date?: string): Promise<Task[]> {
    const queryParams = date ? `?date=${date}` : '';
    return apiClient.get<Task[]>(`${API_ENDPOINTS.TASKS.SCHEDULE}${queryParams}`);
  },

  /**
   * Get unscheduled tasks
   */
  async getUnscheduledTasks(): Promise<Task[]> {
    return apiClient.get<Task[]>(API_ENDPOINTS.TASKS.UNSCHEDULED);
  },

  /**
   * Get dropout tasks
   */
  async getDropoutTasks(): Promise<Task[]> {
    return apiClient.get<Task[]>(API_ENDPOINTS.TASKS.DROPOUT);
  },

  /**
   * Mark task as completed
   */
  async completeTask(id: string): Promise<Task> {
    return apiClient.patch<Task>(API_ENDPOINTS.TASKS.UPDATE(id), {
      status: 'completed',
    });
  },

  /**
   * Mark task as dropout
   */
  async markAsDropout(id: string): Promise<Task> {
    return apiClient.patch<Task>(API_ENDPOINTS.TASKS.UPDATE(id), {
      status: 'dropout',
    });
  },

  /**
   * Reschedule a task
   */
  async rescheduleTask(id: string, data: { date: string; earliestStart: string; latestEnd: string }): Promise<Task> {
    return apiClient.patch<Task>(API_ENDPOINTS.TASKS.UPDATE(id), data);
  },

  /**
   * Bulk update tasks
   */
  async bulkUpdateTasks(updates: Array<{ id: string; data: UpdateTaskRequest }>): Promise<Task[]> {
    return apiClient.post<Task[]>('/tasks/bulk-update', { updates });
  },

  /**
   * Bulk delete tasks
   */
  async bulkDeleteTasks(ids: string[]): Promise<void> {
    return apiClient.post<void>('/tasks/bulk-delete', { ids });
  },
};

