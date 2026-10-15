import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionFormValues } from "@zenflow/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * What the task composer remembers between opens. A draft of a new task
 * survives swiping the sheet down, and the course memory keeps the last
 * duration used for each course. Both persist across app restarts.
 */
type State = {
  /** Unsaved new-task drafts, keyed by `DRAFT_NEW`. */
  drafts: Record<string, SessionFormValues>;
  /** Last duration (minutes) used per course, keyed by the course tag. */
  courseDuration: Record<string, number>;
};

type Action = {
  saveDraft: (key: string, values: SessionFormValues) => void;
  clearDraft: (key: string) => void;
  rememberDuration: (course: string, minutes: number) => void;
};

export const DRAFT_NEW = "new";

export const useComposerStore = create<State & Action>()(
  persist(
    (set, get) => ({
      drafts: {},
      courseDuration: {},
      saveDraft: (key, values) =>
        set({ drafts: { ...get().drafts, [key]: values } }),
      clearDraft: (key) => {
        const next = { ...get().drafts };
        delete next[key];
        set({ drafts: next });
      },
      rememberDuration: (course, minutes) => {
        if (!course) return;
        set({
          courseDuration: { ...get().courseDuration, [course]: minutes },
        });
      },
    }),
    {
      name: "task-composer",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
