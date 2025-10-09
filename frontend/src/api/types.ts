// Schedule Types
export interface Schedule {
  id: string;
  date: string;
  tasks: ScheduledTask[];
}

export interface ScheduledTask {
  id: string;
  title: string;
  splits: TaskSplit[];
}

export interface TaskSplit {
  id: string;
  startTime: string;
  endTime: string;
  duration: number;
}

export interface UpdateTaskSplitRequest {
  startTime: string;
  endTime: string;
  duration: number;
}

// Authentication Types
export interface SendOTPRequest {
  email: string;
}

export interface SendOTPResponse {
  message: string;
  email: string;
}

export interface VerifyOTPRequest {
  email: string;
  otp: string;
}

export interface VerifyOTPResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

// User Types
export interface User {
  id: string;
  email: string;
  displayName?: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  timezone: string;
  avatarUrl?: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  timezone?: string;
  avatarUrl?: string;
}

// Task Types
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskFocus = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'scheduled' | 'completed' | 'dropout' | 'unscheduled';

export interface Task {
  id: string;
  title: string;
  date: string;
  duration: number; // in minutes
  priority: TaskPriority;
  focus: TaskFocus;
  categoryId?: string;
  category?: Category;
  earliestStart: string; // HH:mm format
  latestEnd: string; // HH:mm format
  deadline?: string;
  deadlineTime?: string;
  notes?: string;
  isFixed: boolean;
  maxSplits: number;
  prerequisiteIds?: string[];
  prerequisites?: Task[];
  status: TaskStatus;
  schedules?: TaskSchedule[];
  splits?: TaskSplit[];
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSchedule {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string;
  date: string;
}

export interface TaskSplit {
  id: string;
  taskId: string;
  duration: number; // in minutes
  order: number;
}

export interface CreateTaskRequest {
  title: string;
  date: string;
  duration: number;
  priority: TaskPriority;
  focus: TaskFocus;
  categoryId?: string;
  earliestStart: string;
  latestEnd: string;
  deadline?: string;
  deadlineTime?: string;
  notes?: string;
  isFixed: boolean;
  maxSplits: number;
  prerequisiteIds?: string[];
  imageUrl?: string;
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: TaskStatus;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  page: number;
  pageSize: number;
}

// Category Types
export interface Category {
  id: string;
  name: string;
  color: string;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryRequest {
  name: string;
  color: string;
}

export interface UpdateCategoryRequest {
  name?: string;
  color?: string;
}

// Focus Block Types
export interface FocusBlock {
  id: string;
  name: string;
  duration: number; // in minutes
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFocusBlockRequest {
  name: string;
  duration: number;
  color: string;
}

export interface UpdateFocusBlockRequest {
  name?: string;
  duration?: number;
  color?: string;
}

// Scheduling Types
export interface SchedulingSettings {
  autoScheduling: boolean;
  breakBetweenTasks: boolean;
  breakDuration: number; // in minutes
  maxTasksPerDay: number;
  workingHours: {
    start: string; // HH:mm format
    end: string; // HH:mm format
  };
  timezone: string;
}

export interface UpdateSchedulingSettingsRequest extends Partial<SchedulingSettings> {}

export interface AutoScheduleRequest {
  date?: string;
  taskIds?: string[];
}

export interface AutoScheduleResponse {
  scheduledTasks: Task[];
  dropoutTasks: Task[];
  unscheduledTasks: Task[];
  message: string;
}

// User Settings Types
export interface UserSettings {
  notifications: {
    taskReminders: boolean;
    focusSessions: boolean;
    dailySummary: boolean;
    emailNotifications: boolean;
  };
  appearance: {
    theme: 'light' | 'dark' | 'system';
    accentColor: string;
    fontSize: 'small' | 'medium' | 'large';
    density: 'compact' | 'comfortable' | 'spacious';
  };
  scheduling: SchedulingSettings;
}

export interface UpdateUserSettingsRequest extends Partial<UserSettings> {}

// Calendar Types
export interface DailySchedule {
  date: string;
  tasks: Task[];
  dropoutTasks: Task[];
  unscheduledTasks: Task[];
  totalScheduledDuration: number;
  totalDropoutDuration: number;
  totalUnscheduledDuration: number;
}

export interface WeeklySchedule {
  startDate: string;
  endDate: string;
  days: DailySchedule[];
}

export interface MonthlySchedule {
  year: number;
  month: number;
  days: {
    date: string;
    taskCount: number;
    hasDropout: boolean;
  }[];
}

// API Response wrapper
export interface APIResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// Pagination
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Error response
export interface ErrorResponse {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
}

