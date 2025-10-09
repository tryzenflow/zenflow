import { useState, useCallback, useEffect } from 'react';
import { categoriesService } from '../api';
import type { Category, CreateCategoryRequest, UpdateCategoryRequest } from '../api';

/**
 * Categories Hook
 * Manages categories state and operations
 */
export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedCategories = await categoriesService.getCategories();
      setCategories(fetchedCategories);
      return fetchedCategories;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch categories';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createCategory = useCallback(async (data: CreateCategoryRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const newCategory = await categoriesService.createCategory(data);
      setCategories((prev) => [...prev, newCategory]);
      return newCategory;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to create category';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateCategory = useCallback(
    async (id: string, data: UpdateCategoryRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        const updatedCategory = await categoriesService.updateCategory(id, data);
        setCategories((prev) =>
          prev.map((category) => (category.id === id ? updatedCategory : category))
        );
        return updatedCategory;
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to update category';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const deleteCategory = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await categoriesService.deleteCategory(id);
      setCategories((prev) => prev.filter((category) => category.id !== id));
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to delete category';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  return {
    categories,
    isLoading,
    error,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
  };
}

