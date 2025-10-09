import { useState, useCallback, useEffect } from 'react';
import { userService } from '../api';
import type {
  UserProfile,
  UpdateProfileRequest,
  UserSettings,
  UpdateUserSettingsRequest,
} from '../api';

/**
 * User Profile Hook
 */
export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedProfile = await userService.getProfile();
      setProfile(fetchedProfile);
      return fetchedProfile;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch user profile';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateProfile = useCallback(async (data: UpdateProfileRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedProfile = await userService.updateProfile(data);
      setProfile(updatedProfile);
      return updatedProfile;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update user profile';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    profile,
    isLoading,
    error,
    fetchProfile,
    updateProfile,
  };
}

/**
 * User Settings Hook
 */
export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedSettings = await userService.getSettings();
      setSettings(fetchedSettings);
      return fetchedSettings;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch user settings';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (data: UpdateUserSettingsRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSettings = await userService.updateSettings(data);
      setSettings(updatedSettings);
      return updatedSettings;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update user settings';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateNotifications = useCallback(
    async (notifications: Partial<UserSettings['notifications']>) => {
      setIsLoading(true);
      setError(null);
      try {
        const updatedSettings = await userService.updateNotificationSettings(
          notifications
        );
        setSettings(updatedSettings);
        return updatedSettings;
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to update notification settings';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const updateAppearance = useCallback(
    async (appearance: Partial<UserSettings['appearance']>) => {
      setIsLoading(true);
      setError(null);
      try {
        const updatedSettings = await userService.updateAppearanceSettings(
          appearance
        );
        setSettings(updatedSettings);
        return updatedSettings;
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to update appearance settings';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    settings,
    isLoading,
    error,
    fetchSettings,
    updateSettings,
    updateNotifications,
    updateAppearance,
  };
}

