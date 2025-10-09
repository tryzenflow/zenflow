import { apiClient } from './client';
import { API_ENDPOINTS } from './config';
import {
  UserProfile,
  UpdateProfileRequest,
  UserSettings,
  UpdateUserSettingsRequest,
} from './types';

/**
 * User Service
 * Handles user profile and settings operations
 */
export const userService = {
  /**
   * Get user profile
   */
  async getProfile(): Promise<UserProfile> {
    return apiClient.get<UserProfile>(API_ENDPOINTS.USER.PROFILE);
  },

  /**
   * Update user profile
   */
  async updateProfile(data: UpdateProfileRequest): Promise<UserProfile> {
    const response = await apiClient.put<UserProfile>(
      API_ENDPOINTS.USER.UPDATE_PROFILE,
      data
    );
    
    // Update local storage
    const currentUser = localStorage.getItem('user');
    if (currentUser) {
      const user = JSON.parse(currentUser);
      localStorage.setItem('user', JSON.stringify({ ...user, ...response }));
    }
    
    return response;
  },

  /**
   * Get user settings
   */
  async getSettings(): Promise<UserSettings> {
    return apiClient.get<UserSettings>(API_ENDPOINTS.USER.SETTINGS);
  },

  /**
   * Update user settings
   */
  async updateSettings(data: UpdateUserSettingsRequest): Promise<UserSettings> {
    return apiClient.put<UserSettings>(
      API_ENDPOINTS.USER.UPDATE_SETTINGS,
      data
    );
  },

  /**
   * Update notification settings
   */
  async updateNotificationSettings(
    notifications: Partial<UserSettings['notifications']>
  ): Promise<UserSettings> {
    return apiClient.patch<UserSettings>(API_ENDPOINTS.USER.UPDATE_SETTINGS, {
      notifications,
    });
  },

  /**
   * Update appearance settings
   */
  async updateAppearanceSettings(
    appearance: Partial<UserSettings['appearance']>
  ): Promise<UserSettings> {
    return apiClient.patch<UserSettings>(API_ENDPOINTS.USER.UPDATE_SETTINGS, {
      appearance,
    });
  },

  /**
   * Change password
   */
  async changePassword(data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    return apiClient.post<void>('/user/change-password', data);
  },

  /**
   * Delete account
   */
  async deleteAccount(password: string): Promise<void> {
    return apiClient.post<void>('/user/delete-account', { password });
  },
};

