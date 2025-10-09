import { apiClient } from './client';
import { API_ENDPOINTS } from './config';
import {
  FocusBlock,
  CreateFocusBlockRequest,
  UpdateFocusBlockRequest,
} from './types';

/**
 * Focus Blocks Service
 * Handles focus block management operations
 */
export const focusBlocksService = {
  /**
   * Get all focus blocks
   */
  async getFocusBlocks(): Promise<FocusBlock[]> {
    return apiClient.get<FocusBlock[]>(API_ENDPOINTS.FOCUS_BLOCKS.LIST);
  },

  /**
   * Get a single focus block by ID
   */
  async getFocusBlock(id: string): Promise<FocusBlock> {
    return apiClient.get<FocusBlock>(API_ENDPOINTS.FOCUS_BLOCKS.GET(id));
  },

  /**
   * Create a new focus block
   */
  async createFocusBlock(data: CreateFocusBlockRequest): Promise<FocusBlock> {
    return apiClient.post<FocusBlock>(API_ENDPOINTS.FOCUS_BLOCKS.CREATE, data);
  },

  /**
   * Update an existing focus block
   */
  async updateFocusBlock(id: string, data: UpdateFocusBlockRequest): Promise<FocusBlock> {
    return apiClient.put<FocusBlock>(API_ENDPOINTS.FOCUS_BLOCKS.UPDATE(id), data);
  },

  /**
   * Delete a focus block
   */
  async deleteFocusBlock(id: string): Promise<void> {
    return apiClient.delete<void>(API_ENDPOINTS.FOCUS_BLOCKS.DELETE(id));
  },
};

