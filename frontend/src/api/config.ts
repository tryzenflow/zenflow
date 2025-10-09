// API Configuration
// In development on ports 3000/3001, default to relative paths to use CRA proxy (avoid CORS)
const DEV_PORTS = new Set(['3000', '3001']);
const envBase = process.env.REACT_APP_API_BASE_URL;
const isDev = process.env.NODE_ENV === 'development';
const shouldUseProxy =
  typeof window !== 'undefined' &&
  isDev &&
  DEV_PORTS.has(window.location.port || '') &&
  (!envBase || envBase === 'auto');

export const API_BASE_URL = shouldUseProxy ? '' : (envBase || 'http://localhost:5000');

// HTTP status helpers
export const HTTP_STATUS = {
  NO_CONTENT: 204,
  UNAUTHORIZED: 401,
};

// Build request headers; includeAuth will add Authorization header when true
export function getHeaders(includeAuth = true): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (includeAuth) {
    const token = localStorage.getItem('accessToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

// API Endpoints
export const API_ENDPOINTS = {
  // Users
  USERS: {
    UPDATE_BASIC_INFO: '/users/update/basic-info',
  },

  // Authentication
  AUTH: {
    SEND_OTP: '/auth/otp/request',
    VERIFY_OTP: '/auth/otp/verify',
    GET_ME: '/auth/me',
    LOGOUT: '/auth/logout',
  },

  // Scheduler
  SCHEDULER: {
    CREATE: '/schedule',
  },

  // Schedules
  SCHEDULES: {
    LIST: '/schedules',
    UPDATE_SPLIT: (year: number, month: number, day: number, taskId: string, splitId: string) => 
      `/schedules/${year}/${month}/${day}/tasks/${taskId}/split/${splitId}`,
    DELETE_SPLIT: (year: number, month: number, day: number, taskId: string, splitId: string) => 
      `/schedules/${year}/${month}/${day}/tasks/${taskId}/split/${splitId}`,
    GET_SETTINGS: '/schedules/settings',
  },

  // Tasks
  TASKS: {
    LIST: '/tasks',
    CREATE: '/tasks',
    GET: (id: string) => `/tasks/${id}`,
    UPDATE: (id: string) => `/tasks/${id}`,
    DELETE: (id: string) => `/tasks/${id}`,
    BY_DATE: (date: string) => `/tasks/by-date/${date}`,
    SCHEDULE: '/tasks/schedule',
    UNSCHEDULED: '/tasks/unscheduled',
    DROPOUT: '/tasks/dropout',
  },

  // Constraints
  CONSTRAINTS: {
    CREATE: '/constraints',
    LIST: '/constraints',
    GET: (id: string) => `/constraints/${id}`,
    UPDATE: (id: string) => `/constraints/${id}`,
  },

  // Categories
  CATEGORIES: {
    POPULATE: '/categories/populate',
    CREATE: '/categories',
    LIST: '/categories',
    GET: (id: string) => `/categories/${id}`,
    UPDATE: (id: string) => `/categories/${id}`,
    DELETE: (id: string) => `/categories/${id}`,
  },

  // Calendar
  CALENDAR: {
    DAILY: (date: string) => `/calendar/daily/${date}`,
    WEEKLY: (startDate: string) => `/calendar/weekly/${startDate}`,
    MONTHLY: (year: number, month: number) => `/calendar/monthly/${year}/${month}`,
  },

  // User
  USER: {
    PROFILE: '/auth/me',
    UPDATE_PROFILE: '/users/update/basic-info',
    SETTINGS: '/users/settings',
    UPDATE_SETTINGS: '/users/settings',
  },

  // Focus blocks / Constraints sub-resources
  FOCUS_BLOCKS: {
    LIST: '/constraints/focus-blocks',
    GET: (id: string) => `/constraints/focus-blocks/${id}`,
    CREATE: '/constraints/focus-blocks',
    UPDATE: (id: string) => `/constraints/focus-blocks/${id}`,
    DELETE: (id: string) => `/constraints/focus-blocks/${id}`,
  },

  // Scheduling specific endpoints
  SCHEDULING: {
    UPDATE_SETTINGS: '/schedules/settings',
    AUTO_SCHEDULE: '/scheduling/auto',
    RESCHEDULE: '/scheduling/reschedule',
  },

  // Files
  FILES: {
    UPLOAD: '/files/upload',
    REMOVE: '/files/remove',
    GET: (id: string) => `/files/${id}`,
  },
};

