import type { Session, User } from "@zenflow/shared";
import { zonedNow } from "@zenflow/core";
import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";
import { MonthAgendaWidget } from "@/components/widget/month-agenda-widget";
import { NextUpWidget } from "@/components/widget/next-up-widget";
import { loadWidgetHorizon, makeWidgetSnapshot } from "./widget-snapshot";
import { readWidgetCalendarDate, writeWidgetSnapshot } from "./widget-storage";

let user: User | null = null;
let cachedSessions: Session[] = [];
let horizonSessions: Session[] = [];
let calendarSessions: Session[] = [];
let pending = Promise.resolve();
let userEpoch = 0;
let horizonRequestEpoch = 0;
let horizonTimer: ReturnType<typeof setTimeout> | null = null;

function enqueueSnapshot() {
  if (Platform.OS !== "android") return;
  const snapshot = user
    ? makeWidgetSnapshot(
        [...horizonSessions, ...cachedSessions],
        user.lang,
        user.timezone || "UTC",
        Date.now(),
        [...calendarSessions, ...horizonSessions, ...cachedSessions],
      )
    : null;
  pending = pending
    .catch(() => {})
    .then(async () => {
      await writeWidgetSnapshot(snapshot);
      const selectedDate = await readWidgetCalendarDate();
      await requestWidgetUpdate({
        widgetName: "MonthAgenda",
        renderWidget: () => <MonthAgendaWidget snapshot={snapshot} selectedDate={selectedDate} />,
      });
      for (const [widgetName, size] of [
        ["NextUpSmall", "small"],
        ["NextUpMedium", "medium"],
      ] as const) {
        await requestWidgetUpdate({
          widgetName,
          renderWidget: () => <NextUpWidget snapshot={snapshot} size={size} />,
        });
      }
    })
    .catch(() => {});
}

async function refreshWidgetHorizon() {
  const currentUser = user;
  if (!currentUser || Platform.OS !== "android") return;
  const epoch = userEpoch;
  const requestEpoch = ++horizonRequestEpoch;
  const today = zonedNow(currentUser.timezone || "UTC");
  try {
    const { listSessions } = await import("@/api/tasks");
    const [sessions, thisMonth, nextMonth] = await Promise.all([
      loadWidgetHorizon(today, async (monday) => (await listSessions("week", monday)).sessions),
      listSessions("month", today),
      listSessions("month", new Date(today.getFullYear(), today.getMonth() + 1, 1)),
    ]);
    if (
      epoch !== userEpoch ||
      requestEpoch !== horizonRequestEpoch ||
      user?.id !== currentUser.id
    ) return;
    horizonSessions = sessions;
    calendarSessions = [...thisMonth.sessions, ...nextMonth.sessions];
    enqueueSnapshot();
  } catch {
    // Keep saved events when offline.
  }
}

function scheduleHorizonRefresh() {
  if (Platform.OS !== "android" || !user) return;
  if (horizonTimer) clearTimeout(horizonTimer);
  horizonTimer = setTimeout(() => {
    horizonTimer = null;
    void refreshWidgetHorizon();
  }, 250);
}

export function setWidgetUser(next: User | null) {
  if (user?.id !== next?.id) {
    userEpoch++;
    horizonRequestEpoch++;
    cachedSessions = [];
    horizonSessions = [];
    calendarSessions = [];
  }
  user = next;
  if (!next && horizonTimer) clearTimeout(horizonTimer);
  enqueueSnapshot();
  scheduleHorizonRefresh();
}

export function publishWidgetSessions(sessions: Session[]) {
  cachedSessions = sessions;
  enqueueSnapshot();
  scheduleHorizonRefresh();
}

export function invalidateWidgetHorizon() {
  horizonRequestEpoch++;
  horizonSessions = [];
  calendarSessions = [];
  enqueueSnapshot();
  scheduleHorizonRefresh();
}
