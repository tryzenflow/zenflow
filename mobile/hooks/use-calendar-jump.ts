import { create } from "zustand";

/**
 * A tiny bridge between the checklist and the two calendar screens: "show me"
 * asks the Week / Month screen to move to a day / month that has a task, and
 * both screens publish what they are currently showing so the checklist can
 * search outward from it. Screens consume (and clear) a request in an effect.
 */
export const useCalendarJump = create<{
  /** Week view: day to focus. */
  weekJump: Date | null;
  /** Month view: month to show. */
  monthJump: Date | null;
  focusedWeekDay: Date | null;
  focusedMonth: Date | null;
  jumpWeek: (day: Date) => void;
  jumpMonth: (month: Date) => void;
  clearWeekJump: () => void;
  clearMonthJump: () => void;
  setFocusedWeekDay: (day: Date) => void;
  setFocusedMonth: (month: Date) => void;
}>((set) => ({
  weekJump: null,
  monthJump: null,
  focusedWeekDay: null,
  focusedMonth: null,
  jumpWeek: (day) => set({ weekJump: day }),
  jumpMonth: (month) => set({ monthJump: month }),
  clearWeekJump: () => set({ weekJump: null }),
  clearMonthJump: () => set({ monthJump: null }),
  setFocusedWeekDay: (day) => set({ focusedWeekDay: day }),
  setFocusedMonth: (month) => set({ focusedMonth: month }),
}));
