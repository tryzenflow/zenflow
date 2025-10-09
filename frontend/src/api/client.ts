import { API_BASE_URL, getHeaders, HTTP_STATUS } from './config';

// API Error class
export class APIError extends Error {
  status: number;
  data?: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.data = data;
  }
}

// Request options interface
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  headers?: HeadersInit;
  includeAuth?: boolean;
}

// Generic API client
class APIClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      headers: customHeaders,
      includeAuth = true,
    } = options;

    const config: RequestInit = {
      method,
      headers: {
        ...getHeaders(includeAuth),
        ...customHeaders,
      },
      credentials: 'include',
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, config);

      // Handle empty responses (204 No Content)
      if (response.status === HTTP_STATUS.NO_CONTENT) {
        return {} as T;
      }

      const data = await response.json();

      if (!response.ok) {
        // Handle token expiration
        if (response.status === HTTP_STATUS.UNAUTHORIZED) {
          // Try to refresh token
          const refreshed = await this.refreshToken();
          if (refreshed) {
            // Retry the original request
            return this.request<T>(endpoint, options);
          } else {
            // Clear auth data and redirect to login
            this.clearAuth();
            throw new APIError('Session expired. Please log in again.', response.status, data);
          }
        }

        throw new APIError(
          data.message || 'An error occurred',
          response.status,
          data
        );
      }

      return data;
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      
      // Network or other errors
      throw new APIError(
        error instanceof Error ? error.message : 'Network error occurred',
        0
      );
    }
  }

  // Refresh token
  private async refreshToken(): Promise<boolean> {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        return false;
      }

      const response = await fetch(`${this.baseURL}/auth/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('accessToken', data.accessToken);
        if (data.refreshToken) {
          localStorage.setItem('refreshToken', data.refreshToken);
        }
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  // Clear authentication data
  private clearAuth(): void {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }

  // HTTP methods
  async get<T>(endpoint: string, includeAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', includeAuth });
  }

  async post<T>(endpoint: string, body?: any, includeAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body, includeAuth });
  }

  async put<T>(endpoint: string, body?: any, includeAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body, includeAuth });
  }

  async patch<T>(endpoint: string, body?: any, includeAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body, includeAuth });
  }

  async delete<T>(endpoint: string, includeAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', includeAuth });
  }
}

// Export singleton instance
export const apiClient = new APIClient(API_BASE_URL);

