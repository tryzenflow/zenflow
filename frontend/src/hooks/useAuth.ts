import { useState, useCallback } from 'react';
import { authService } from '../api';
import type { User, SendOTPRequest, VerifyOTPRequest } from '../api';

/**
 * Authentication Hook
 * Manages authentication state and operations
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(authService.getCurrentUser());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendOTP = useCallback(async (data: SendOTPRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authService.sendOTP(data);
      return response;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to send OTP';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const verifyOTP = useCallback(async (data: VerifyOTPRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authService.verifyOTP(data);
      setUser(response.user);
      return response;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to verify OTP';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await authService.logout();
      setUser(null);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to logout';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const isAuthenticated = authService.isAuthenticated();

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    sendOTP,
    verifyOTP,
    logout,
  };
}

