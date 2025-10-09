import { apiClient } from './client';
import { API_ENDPOINTS } from './config';
import {
  SendOTPRequest,
  SendOTPResponse,
  VerifyOTPRequest,
  VerifyOTPResponse,
} from './types';

/**
 * Authentication Service
 * Handles user authentication operations
 */
export const authService = {
  /**
   * Send OTP to user's email
   */
  async sendOTP(data: SendOTPRequest): Promise<SendOTPResponse> {
    return apiClient.post<SendOTPResponse>(
      API_ENDPOINTS.AUTH.SEND_OTP,
      data,
      false // No auth required
    );
  },

  /**
   * Verify OTP and login
   */
  async verifyOTP(data: VerifyOTPRequest): Promise<VerifyOTPResponse> {
    const response = await apiClient.post<VerifyOTPResponse>(
      API_ENDPOINTS.AUTH.VERIFY_OTP,
      data,
      false // No auth required
    );

    // Store tokens and user info
    if (response.accessToken) {
      localStorage.setItem('accessToken', response.accessToken);
      localStorage.setItem('refreshToken', response.refreshToken);
      localStorage.setItem('user', JSON.stringify(response.user));
    }

    return response;
  },

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      await apiClient.post(API_ENDPOINTS.AUTH.LOGOUT);
    } finally {
      // Clear local storage regardless of API response
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  },
  
  /**
   * Get current user from local storage
   */
  getCurrentUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const token = localStorage.getItem('accessToken');
    return !!token;
  },

  /**
   * Get access token
   */
  getAccessToken(): string | null {
    return localStorage.getItem('accessToken');
  },
};

