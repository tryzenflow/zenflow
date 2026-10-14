import type { Session, User } from "@zenflow/shared";
import { zonedNow } from "@zenflow/core";
import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";
import { MonthAgendaWidget } from "@/components/widget/month-agenda-widget";
import { loadWidgetHorizon, makeWidgetSnapshot } from "./widget-snapshot";
import { writeWidgetSnapshot } from "./widget-storage";

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
      await requestWidgetUpdate({
        widgetName: "NextUpMedium",
        renderWidget: (info) => <MonthAgendaWidget snapshot={snapshot} compact width={info.width} />,
      });
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
    const [horizon, thisMonth, nextMonth, todaySessions] = await Promise.allSettled([
      loadWidgetHorizon(today, async (monday) => (await listSessions("week", monday)).sessions),
      listSessions("month", today),
      listSessions("month", new Date(today.getFullYear(), today.getMonth() + 1, 1)),
      listSessions("day", today),
    ]);
    if (
      epoch !== userEpoch ||
      requestEpoch !== horizonRequestEpoch ||
      user?.id !== currentUser.id
    ) return;
    if (horizon.status === "fulfilled") horizonSessions = horizon.value;
    calendarSessions = [
      ...(thisMonth.status === "fulfilled" ? thisMonth.value.sessions : []),
      ...(nextMonth.status === "fulfilled" ? nextMonth.value.sessions : []),
      ...(todaySessions.status === "fulfilled" ? todaySessions.value.sessions : []),
    ];
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
