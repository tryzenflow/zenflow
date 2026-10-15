import {
  listCourseColours,
  resetCourseColour,
  setCourseColour,
} from "@/api/course-colours";
import { useEffect } from "react";
import { AppState } from "react-native";
import { create } from "zustand";

/**
 * The signed-in user's course colour picks (issue #238), keyed by
 * `courseKey`. A course without a pick paints with its automatic colour.
 * Reloads on every foreground so a change made on another device appears here.
 */
type State = {
  overrides: Map<string, number>;
};

type Action = {
  load: () => Promise<void>;
  setColour: (courseKey: string, swatch: number) => Promise<void>;
  resetColour: (courseKey: string) => Promise<void>;
};

export const useCourseColourStore = create<State & Action>((set, get) => ({
  overrides: new Map(),

  load: async () => {
    try {
      const colours = await listCourseColours();
      set({
        overrides: new Map(colours.map((c) => [c.courseKey, c.swatch])),
      });
    } catch {
      // Offline or signed out: keep the last known picks.
    }
  },

  setColour: async (courseKey, swatch) => {
    const next = new Map(get().overrides);
    next.set(courseKey, swatch);
    set({ overrides: next });
    try {
      await setCourseColour(courseKey, swatch);
    } catch {
      await get().load();
    }
  },

  resetColour: async (courseKey) => {
    const next = new Map(get().overrides);
    next.delete(courseKey);
    set({ overrides: next });
    try {
      await resetCourseColour(courseKey);
    } catch {
      await get().load();
    }
  },
}));

/** Loads the picks on mount and whenever the app returns to the foreground. */
export function useCourseColourSync(enabled = true): void {
  const load = useCourseColourStore((s) => s.load);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => sub.remove();
  }, [enabled, load]);
}
