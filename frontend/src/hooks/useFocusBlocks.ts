import { useState, useCallback, useEffect } from 'react';
import { focusBlocksService } from '../api';
import type {
  FocusBlock,
  CreateFocusBlockRequest,
  UpdateFocusBlockRequest,
} from '../api';

/**
 * Focus Blocks Hook
 * Manages focus blocks state and operations
 */
export function useFocusBlocks() {
  const [focusBlocks, setFocusBlocks] = useState<FocusBlock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFocusBlocks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedBlocks = await focusBlocksService.getFocusBlocks();
      setFocusBlocks(fetchedBlocks);
      return fetchedBlocks;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch focus blocks';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createFocusBlock = useCallback(async (data: CreateFocusBlockRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const newBlock = await focusBlocksService.createFocusBlock(data);
      setFocusBlocks((prev) => [...prev, newBlock]);
      return newBlock;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to create focus block';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateFocusBlock = useCallback(
    async (id: string, data: UpdateFocusBlockRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        const updatedBlock = await focusBlocksService.updateFocusBlock(id, data);
        setFocusBlocks((prev) =>
          prev.map((block) => (block.id === id ? updatedBlock : block))
        );
        return updatedBlock;
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to update focus block';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const deleteFocusBlock = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await focusBlocksService.deleteFocusBlock(id);
      setFocusBlocks((prev) => prev.filter((block) => block.id !== id));
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to delete focus block';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFocusBlocks();
  }, [fetchFocusBlocks]);

  return {
    focusBlocks,
    isLoading,
    error,
    fetchFocusBlocks,
    createFocusBlock,
    updateFocusBlock,
    deleteFocusBlock,
  };
}

