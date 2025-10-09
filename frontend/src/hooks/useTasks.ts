import { useState, useCallback, useEffect } from 'react';
import { tasksService } from '../api';
import type { Task, CreateTaskRequest, UpdateTaskRequest, PaginationParams } from '../api';

/**
 * Tasks Hook
 * Manages tasks state and operations
 */
export function useTasks(initialParams?: PaginationParams) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchTasks = useCallback(async (params?: PaginationParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await tasksService.getTasks(params || initialParams);
      setTasks(response.tasks);
      setTotal(response.total);
      return response;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch tasks';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [initialParams]);

  const createTask = useCallback(async (data: CreateTaskRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const newTask = await tasksService.createTask(data);
      setTasks((prev) => [...prev, newTask]);
      setTotal((prev) => prev + 1);
      return newTask;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to create task';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateTask = useCallback(async (id: string, data: UpdateTaskRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedTask = await tasksService.updateTask(id, data);
      setTasks((prev) =>
        prev.map((task) => (task.id === id ? updatedTask : task))
      );
      return updatedTask;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update task';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await tasksService.deleteTask(id);
      setTasks((prev) => prev.filter((task) => task.id !== id));
      setTotal((prev) => prev - 1);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to delete task';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const completeTask = useCallback(async (id: string) => {
    return updateTask(id, { status: 'completed' });
  }, [updateTask]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return {
    tasks,
    isLoading,
    error,
    total,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    completeTask,
  };
}

/**
 * Single Task Hook
 * Manages a single task state
 */
export function useTask(id: string) {
  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTask = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedTask = await tasksService.getTask(id);
      setTask(fetchedTask);
      return fetchedTask;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch task';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchTask();
    }
  }, [id, fetchTask]);

  return {
    task,
    isLoading,
    error,
    refetch: fetchTask,
  };
}

/**
 * Tasks by Date Hook
 */
export function useTasksByDate(date: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!date) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const fetchedTasks = await tasksService.getTasksByDate(date);
      setTasks(fetchedTasks);
      return fetchedTasks;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch tasks';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return {
    tasks,
    isLoading,
    error,
    refetch: fetchTasks,
  };
}

