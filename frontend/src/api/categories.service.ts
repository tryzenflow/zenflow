import { apiClient } from './client';
import { API_ENDPOINTS } from './config';
import {
  Category,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from './types';

/**
 * Categories Service
 * Handles category management operations
 */
export const categoriesService = {
  /**
   * Get all categories
   */
  async getCategories(): Promise<Category[]> {
    return apiClient.get<Category[]>(API_ENDPOINTS.CATEGORIES.LIST);
  },

  /**
   * Get a single category by ID
   */
  async getCategory(id: string): Promise<Category> {
    return apiClient.get<Category>(API_ENDPOINTS.CATEGORIES.GET(id));
  },

  /**
   * Create a new category
   */
  async createCategory(data: CreateCategoryRequest): Promise<Category> {
    return apiClient.post<Category>(API_ENDPOINTS.CATEGORIES.CREATE, data);
  },

  /**
   * Update an existing category
   */
  async updateCategory(id: string, data: UpdateCategoryRequest): Promise<Category> {
    return apiClient.put<Category>(API_ENDPOINTS.CATEGORIES.UPDATE(id), data);
  },

  /**
   * Delete a category
   */
  async deleteCategory(id: string): Promise<void> {
    return apiClient.delete<void>(API_ENDPOINTS.CATEGORIES.DELETE(id));
  },

  /**
   * Get categories with task counts
   */
  async getCategoriesWithCounts(): Promise<Category[]> {
    return apiClient.get<Category[]>(`${API_ENDPOINTS.CATEGORIES.LIST}?includeCounts=true`);
  },
};

