import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { router } from "expo-router";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import NotificationsScreen from "@/app/notifications";
import { useNotificationsStore } from "@/hooks/use-notifications";
import { useUserStore } from "@/hooks/use-user-store";
import { makeNotification, makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const toastShown = (text: string | RegExp) =>
  waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));

let calls: string[];

function seed(items: ReturnType<typeof makeNotification>[]) {
  useNotificationsStore.setState({
    items,
    unreadCount: items.filter((n) => !n.readAt).length,
    loading: false,
    refreshing: false,
    initialized: true,
  });
}

beforeEach(() => {
  calls = [];
  useUserStore.setState({ user: testUser as never, loading: false });
  server.use(
    http.patch(`${API}/notifications/:id/read`, ({ params }) => {
      calls.push(`read:${params.id}`);
      return HttpResponse.json({ data: {} });
    }),
    http.patch(`${API}/notifications/:id/action-taken`, ({ params }) => {
      calls.push(`action:${params.id}`);
      return HttpResponse.json({ data: {} });
    }),
    http.delete(`${API}/notifications/:id`, ({ params }) => {
      calls.push(`delete:${params.id}`);
      return HttpResponse.json({ data: { id: params.id } });
    }),
    http.get(`${API}/notifications`, () =>
      HttpResponse.json({ data: { notifications: [], unreadCount: 0 } }),
    ),
  );
});

describe("NotificationsScreen", () => {
  it("shows an empty inbox", () => {
    seed([]);
    renderScreen(<NotificationsScreen />);
    expect(screen.getByText("You're all caught up")).toBeTruthy();
    expect(screen.queryByText("Select")).toBeNull();
  });

  it("lists notifications with the unread count in the header", () => {
    seed([
      makeNotification({ id: "n1", title: "New assignment", content: "Graph theory report" }),
      makeNotification({ id: "n2", title: "Exam moved", content: "Final moved to Friday", readAt: "2026-10-14T00:00:00.000Z" }),
    ]);
    renderScreen(<NotificationsScreen />);
    expect(screen.getByText("New assignment")).toBeTruthy();
    expect(screen.getByText("Exam moved")).toBeTruthy();
    expect(screen.getByText("Inbox")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy(); // unread badge
  });

  it("closes via the backdrop and the back button", () => {
    seed([]);
    renderScreen(<NotificationsScreen />);
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByLabelText("Back"));
    expect(router.back).toHaveBeenCalledTimes(2);
  });

  describe("opening a row", () => {
    it("marks it read and shows the session on the calendar", async () => {
      server.use(
        http.get(`${API}/sessions/s9`, () =>
          HttpResponse.json({
            data: makeSession({ id: "s9", scheduledStartTime: "2026-10-20T03:00:00.000Z" }),
          }),
        ),
      );
      seed([makeNotification({ id: "n1", title: "New assignment", sessionId: "s9" })]);
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("New assignment"));
      await waitFor(() =>
        expect(router.replace).toHaveBeenCalledWith({
          pathname: "/",
          params: { date: "2026-10-20T03:00:00.000Z", flash: "s9" },
        }),
      );
      expect(calls).toContain("read:n1");
      expect(calls).toContain("action:n1");
      expect(useNotificationsStore.getState().unreadCount).toBe(0);
    });

    it("says so when the session is no longer on the calendar", async () => {
      server.use(http.get(`${API}/sessions/gone`, () => HttpResponse.json({}, { status: 404 })));
      seed([makeNotification({ id: "n1", title: "Old item", sessionId: "gone" })]);
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Old item"));
      await toastShown("Couldn't find that item");
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("only marks a removal (no session) as read", async () => {
      seed([makeNotification({ id: "n1", title: "Lecture removed", sessionId: null })]);
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Lecture removed"));
      await waitFor(() => expect(calls).toEqual(["read:n1"]));
      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  describe("dismissing", () => {
    it("removes a notification", async () => {
      seed([makeNotification({ id: "n1", title: "A" }), makeNotification({ id: "n2", title: "B" })]);
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getAllByText("Dismiss")[0]);
      await waitFor(() => expect(screen.queryByText("A")).toBeNull());
      expect(screen.getByText("B")).toBeTruthy();
      expect(calls).toEqual(["delete:n1"]);
    });

    it("puts it back and says so when the server refuses", async () => {
      server.use(http.delete(`${API}/notifications/:id`, () => HttpResponse.json({}, { status: 500 })));
      seed([makeNotification({ id: "n1", title: "A" })]);
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Dismiss"));
      await toastShown("Couldn't dismiss notification");
      expect(screen.getByText("A")).toBeTruthy();
    });
  });

  describe("selecting", () => {
    beforeEach(() => {
      seed([
        makeNotification({ id: "n1", title: "A" }),
        makeNotification({ id: "n2", title: "B" }),
        makeNotification({ id: "n3", title: "C" }),
      ]);
    });

    it("deletes just the selected rows", async () => {
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Select"));
      fireEvent.click(screen.getByText("A"));
      fireEvent.click(screen.getByText("C"));
      expect(screen.getByText("2 selected")).toBeTruthy();
      fireEvent.click(screen.getByLabelText("Delete selected"));
      await toastShown("Deleted 2 notifications");
      expect([...calls].sort()).toEqual(["delete:n1", "delete:n3"]);
      expect(screen.getByText("B")).toBeTruthy();
    });

    it("selects all and toggles back to none", () => {
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Select"));
      fireEvent.click(screen.getByText("All"));
      expect(screen.getByText("3 selected")).toBeTruthy();
      fireEvent.click(screen.getByText("None"));
      expect(screen.getByText("0 selected")).toBeTruthy();
    });

    it("leaves selecting without deleting", () => {
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Select"));
      fireEvent.click(screen.getByText("A"));
      fireEvent.click(screen.getByLabelText("Cancel selection"));
      expect(screen.getByText("Select")).toBeTruthy();
      expect(calls).toEqual([]);
    });

    it("asks before clearing everything, and clears on confirm", async () => {
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Select"));
      fireEvent.click(screen.getByText("All"));
      fireEvent.click(screen.getByLabelText("Delete selected"));
      expect(await screen.findByText("Clear all notifications?")).toBeTruthy();
      expect(calls).toEqual([]);
      fireEvent.click(screen.getByText("Clear all"));
      await toastShown("All notifications cleared");
      expect(useNotificationsStore.getState().items).toEqual([]);
      expect([...calls].sort()).toEqual(["delete:n1", "delete:n2", "delete:n3"]);
    });

    it("keeps everything when the clear-all prompt is cancelled", async () => {
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Select"));
      fireEvent.click(screen.getByText("All"));
      fireEvent.click(screen.getByLabelText("Delete selected"));
      fireEvent.click(await screen.findByText("Cancel"));
      await waitFor(() => expect(screen.queryByText("Clear all notifications?")).toBeNull());
      expect(useNotificationsStore.getState().items).toHaveLength(3);
    });
  });

  describe("sync conflicts", () => {
    const conflict = () =>
      makeNotification({
        id: "c1",
        eventName: "sync_conflict.exam",
        title: "Exam overlaps your plan",
        conflictSessionIds: ["t1", "t2"],
      });

    it("reschedules every overlapped task", async () => {
      server.use(
        http.post(`${API}/notifications/c1/reschedule-conflicts`, () =>
          HttpResponse.json({
            data: { rescheduled: [{ id: "t1" }, { id: "t2" }], failedSessionIds: [] },
          }),
        ),
      );
      seed([conflict()]);
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Reschedule"));
      await toastShown("Rescheduled 2 tasks");
    });

    it("reports the tasks it couldn't move", async () => {
      server.use(
        http.post(`${API}/notifications/c1/reschedule-conflicts`, () =>
          HttpResponse.json({
            data: { rescheduled: [{ id: "t1" }], failedSessionIds: ["t2"] },
          }),
        ),
      );
      seed([conflict()]);
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Reschedule"));
      await toastShown("Rescheduled 1, 1 left");
      expect(screen.getAllByText("The rest still overlap. Move them by hand.").length).toBeGreaterThan(0);
    });

    it("toasts when rescheduling fails", async () => {
      server.use(
        http.post(`${API}/notifications/c1/reschedule-conflicts`, () => HttpResponse.json({}, { status: 500 })),
      );
      seed([conflict()]);
      renderScreen(<NotificationsScreen />);
      fireEvent.click(screen.getByText("Reschedule"));
      await toastShown("Couldn't reschedule tasks");
    });

    it("hides the action once it has been taken", () => {
      seed([{ ...conflict(), actionTakenAt: "2026-10-15T00:00:00.000Z" }]);
      renderScreen(<NotificationsScreen />);
      expect(screen.queryByText("Reschedule")).toBeNull();
    });
  });
});
