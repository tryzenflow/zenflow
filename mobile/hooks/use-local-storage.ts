import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";
export const useLocalStorage = () => {
  const getItem = useCallback(async (key: string) => {
    try {
      const value = await AsyncStorage.getItem(key);
      return typeof value === "object" && value !== null
        ? JSON.parse(value)
        : value;
    } catch (error) {
      console.error("Error getting item from local storage", error);
      return null;
    }
  }, []);

  const setItem = useCallback(async (key: string, value: any) => {
    if (typeof value === "object") {
      value = JSON.stringify(value);
    }
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error("Error setting item in local storage", error);
    }
  }, []);

  return { getItem, setItem };
};
