import {
  dismissNotification,
  listNotifications,
  markNotificationActionTaken,
  markNotificationRead,
  subscribeNotificationsStream,
} from "@/api/notifications";
import { getSessionDetails } from "@/api/tasks";
import { useToast } from "@/components/ui/toast";
import { useUserStore } from "@/hooks/use-user-store";
import { claimNotification, LOCAL_NOTIFICATION_SOURCE } from "@/lib/push";
import { notifySessionsMutated } from "@/lib/session-cache";
import { notificationEventKind, type NotificationDto } from "@zenflow/shared";
import * as Notifications from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { create } from "zustand";

interface NotificationsState {
  items: NotificationDto[];
  unreadCount: number;
  loading: boolean;
  refreshing: boolean;
  initialized: boolean;
  fetchNotifications: (mode?: "initial" | "refresh") => Promise<void>;
  addNotification: (n: NotificationDto) => void;
  dismiss: (id: string) => Promise<void>;
  dismissMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const INITIAL_NOTIFICATIONS_STATE = {
  items: [],
  unreadCount: 0,
  loading: true,
  refreshing: false,
  initialized: false,
} satisfies Partial<NotificationsState>;

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  ...INITIAL_NOTIFICATIONS_STATE,

  fetchNotifications: async (mode = "initial") => {
    if (mode === "refresh") set({ refreshing: true });
    try {
      const res = await listNotifications({ limit: 50 });
      set({
        items: res.notifications,
        unreadCount: res.unreadCount,
        initialized: true,
      });
    } catch (err) {
      console.warn("[notifications] Failed to fetch:", err);
    } finally {
      set({ loading: false, refreshing: false });
    }
  },

  addNotification: (n: NotificationDto) => {
    set((state) => {
      if (state.items.some((x) => x.id === n.id)) return state;
      return {
        items: [n, ...state.items],
        unreadCount: state.unreadCount + 1,
      };
    });
  },

  dismiss: async (id: string) => {
    const prevItems = get().items;
    const target = prevItems.find((x) => x.id === id);
    if (!target) return;

    // Optimistic removal
    set((state) => ({
      items: state.items.filter((x) => x.id !== id),
      unreadCount: !target.readAt
        ? Math.max(0, state.unreadCount - 1)
        : state.unreadCount,
    }));

    try {
      await dismissNotification(id);
    } catch {
      // Rollback on failure
      set({ items: prevItems });
      throw new Error("Couldn't dismiss notification");
    }
  },

  dismissMany: async (ids: string[]) => {
    if (ids.length === 0) return;
    const prevItems = get().items;
    const idsSet = new Set(ids);
    const unreadRemoved = prevItems.filter(
      (x) => idsSet.has(x.id) && !x.readAt,
    ).length;

    set((state) => ({
      items: state.items.filter((x) => !idsSet.has(x.id)),
      unreadCount: Math.max(0, state.unreadCount - unreadRemoved),
    }));

    try {
      await Promise.all(ids.map((id) => dismissNotification(id)));
    } catch {
      // Rollback on any failure
      set({ items: prevItems });
      throw new Error("Couldn't dismiss notifications");
    }
  },

  clearAll: async () => {
    const prevItems = get().items;
    if (prevItems.length === 0) return;
    const allIds = prevItems.map((x) => x.id);

    set({ items: [], unreadCount: 0 });

    try {
      await Promise.all(allIds.map((id) => dismissNotification(id)));
    } catch {
      // Rollback on any failure
      set({ items: prevItems });
      throw new Error("Couldn't clear notifications");
    }
  },

  markRead: async (id: string) => {
    const target = get().items.find((x) => x.id === id);
    if (!target || target.readAt) return;

    set((state) => ({
      items: state.items.map((x) =>
        x.id === id ? { ...x, readAt: new Date().toISOString() } : x,
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));

    try {
      await markNotificationRead(id);
    } catch {
      // Best-effort
    }
  },

  markAllRead: async () => {
    const unread = get().items.filter((x) => !x.readAt);
    if (unread.length === 0) return;

    set((state) => ({
      items: state.items.map((x) =>
        x.readAt ? x : { ...x, readAt: new Date().toISOString() },
      ),
      unreadCount: 0,
    }));

    await Promise.allSettled(unread.map((x) => markNotificationRead(x.id)));
  },
}));

/**
 * Jump to session edit modal with deleted-session guard (GET /sessions/:id).
 * If the session was deleted, displays an error toast instead of routing.
 */
export async function jumpToSession(
  sessionId: string,
  router: ReturnType<typeof useRouter>,
  toast: ReturnType<typeof useToast>["toast"],
  notificationId?: string,
  replace = false,
) {
  try {
    await getSessionDetails(sessionId);
    if (notificationId) {
      markNotificationActionTaken(notificationId).catch(() => {});
    }
    if (replace) {
      router.replace(`/task/${encodeURIComponent(sessionId)}/edit` as Href);
    } else {
      router.push(`/task/${encodeURIComponent(sessionId)}/edit` as Href);
    }
  } catch {
    toast("That item isn't on your calendar anymore.", "destructive");
  }
}

/**
 * Jump directly to the calendar Week view and flash/highlight this session block.
 */
export async function viewSessionOnCalendar(
  sessionId: string,
  router: ReturnType<typeof useRouter>,
  toast: ReturnType<typeof useToast>["toast"],
  notificationId?: string,
) {
  try {
    const session = await getSessionDetails(sessionId);
    if (notificationId) {
      markNotificationActionTaken(notificationId).catch(() => {});
    }
    const targetDate = session.scheduledStartTime ?? session.createdAt;
    router.replace({
      pathname: "/",
      params: { date: targetDate, flash: session.id },
    } as Href);
  } catch {
    toast("That item isn't on your calendar anymore.", "destructive");
  }
}

/**
 * Headless subscription hook mounted in root layout:
 * - Subscribes to live SSE stream (/notifications/stream).
 * - Shows a tap-to-act toast when a new notification arrives while the app is foregrounded.
 * - Refetches on AppState -> "active" for catch-up.
 */
export function useNotificationsSubscription(): void {
  const router = useRouter();
  const { toast } = useToast();
  const userId = useUserStore((s) => s.user?.id ?? null);
  const addNotification = useNotificationsStore((s) => s.addNotification);
  const fetchNotifications = useNotificationsStore(
    (s) => s.fetchNotifications,
  );
  const initialized = useNotificationsStore((s) => s.initialized);

  const latestRef = useRef({ router, toast });
  latestRef.current = { router, toast };

  // Initial load
  useEffect(() => {
    if (userId && !initialized) {
      fetchNotifications("initial");
    }
  }, [userId, initialized, fetchNotifications]);

  // Catch-up refetch on AppState active
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        fetchNotifications("refresh");
      }
    });
    return () => sub.remove();
  }, [userId, fetchNotifications]);

  // Live SSE stream connection
  const streamOpenedRef = useRef(false);
  useEffect(() => {
    if (!userId) return;
    streamOpenedRef.current = false;

    const unsubscribe = subscribeNotificationsStream({
      onNotification: (n) => {
        addNotification(n);

        // A sync watcher wrote/removed a session behind this notification —
        // the calendar needs to resync. Mirrors the web app's precedent
        // (`frontend/src/components/notifications/notification-bell.tsx`):
        // `CONFLICT` rows carry no session change of their own (they just
        // flag the user's own tasks against a session that already raised
        // its own CREATED/UPDATED elsewhere, and the actual fix-up action —
        // `rescheduleConflicts` in `api/notifications.ts` — already calls
        // `notifySessionsMutated()` itself), so skip invalidation here for
        // that case.
        // A reminder changes no session either — it's just the nudge.
        const kind = notificationEventKind(n.eventName);
        if (kind !== "CONFLICT" && kind !== "REMINDER") {
          notifySessionsMutated();
        }

        // The native push for this same notification may have been
        // presented already — then this is a duplicate: inbox only.
        if (!claimNotification(n.id, "sse")) return;

        const cleanTitle = (n.title || "").replace(/^\[.*?\]\s*/, "").trim();

        // 1. In-app tap-to-act toast with clear title and "View on calendar" action
        const { router: currentRouter, toast: currentToast } =
          latestRef.current;
        currentToast(
          cleanTitle,
          "default",
          8000,
          "top",
          true,
          n.sessionId
            ? {
                label: "View on calendar",
                onPress: () =>
                  viewSessionOnCalendar(
                    n.sessionId!,
                    currentRouter,
                    currentToast,
                    n.id,
                  ),
              }
            : undefined,
          { description: n.content },
        );

        // 2. System notification in Android notification shade / lock screen
        if (Platform.OS !== "web") {
          void Notifications.scheduleNotificationAsync({
            content: {
              title: cleanTitle,
              body: n.content,
              data: {
                sessionId: n.sessionId,
                notificationId: n.id,
                source: LOCAL_NOTIFICATION_SOURCE,
              },
              sound: true,
            },
            trigger: null,
          });
        }
      },
      onError: (err) => {
        console.warn("[notifications-sse] Connection error:", err);
      },
      // On reconnect, refetch the inbox to catch up on the gap (no toasts).
      onOpen: () => {
        if (!streamOpenedRef.current) {
          streamOpenedRef.current = true;
          return;
        }
        void fetchNotifications("refresh");
        notifySessionsMutated();
      },
    });

    return () => {
      unsubscribe();
    };
  }, [userId, addNotification, fetchNotifications]);
}

// Per-user inbox: reset whenever the signed-in user changes.
useUserStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id) {
    useNotificationsStore.setState(INITIAL_NOTIFICATIONS_STATE);
  }
});
