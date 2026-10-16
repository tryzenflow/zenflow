import { getStreak } from "@/api/streak";
import { listSessions } from "@/api/tasks";
import { subscribeToSessionMutations } from "@/lib/session-cache";
import type { SessionCheckOffResponse, Session, Streak } from "@zenflow/shared";
import { zonedNow } from "@zenflow/core";
import { useEffect } from "react";
import { create } from "zustand";

interface TodayState {
  /** Today's sessions, or `null` until the first load. */
  sessions: Session[] | null;
  streak: Streak | null;
  /** Writes the response of a check-off or undo into the Today card's data. */
  applyCheckOff: (res: SessionCheckOffResponse) => void;
}

/**
 * Shared state for the Today card. Check-offs anywhere in the app patch it
 * from their response, so the ring and streak move without waiting for a refetch.
 */
export const useTodayStore = create<TodayState>((set) => ({
  sessions: null,
  streak: null,
  applyCheckOff: ({ session, streak }) =>
    set((state) => ({
      streak,
      sessions: state.sessions?.map((s) =>
        s.id === session.id ? { ...s, ...session } : s,
      ) ?? null,
    })),
}));

/**
 * Loads today's sessions and the streak while mounted, and reloads on every
 * session mutation. Failures keep the last good data.
 */
export function useTodayLoader(tz: string): void {
  useEffect(() => {
    let alive = true;
    // Independent requests: a failed streak read must not hide the sessions.
    const load = () => {
      listSessions("day", zonedNow(tz))
        .then((res) => {
          if (alive) useTodayStore.setState({ sessions: res.sessions });
        })
        .catch(() => {});
      getStreak()
        .then((streak) => {
          if (alive) useTodayStore.setState({ streak });
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = subscribeToSessionMutations(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [tz]);
}
