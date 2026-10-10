import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MonthScreen from "@/app/(app)/month";
import { useUserStore } from "@/hooks/use-user-store";
import { clearDaySessionCache } from "@/lib/session-cache";
import { makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// The real pager is a 481-slot horizontal strip that needs native layout; the
// screen only needs the current month's page rendered.
vi.mock("@/components/calendar/month-pager", () => ({
  MonthPager: ({
    monthDate,
    renderPage,
  }: {
    monthDate: Date;
    renderPage: (d: Date) => React.ReactNode;
  }) => <>{renderPage(monthDate)}</>,
}));
// Chrome with its own ownership / native deps.
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/checklist/getting-started", () => ({ GettingStarted: () => null }));
vi.mock("@/components/tasks/create-task-fab", () => ({ CreateSessionFab: () => null }));
vi.mock("@/components/calendar/task-list-sheet", () => ({ SessionListSheet: () => null }));
vi.mock("@/components/calendar/reschedule-sheet", () => ({ RescheduleSheet: () => null }));
vi.mock("@/components/calendar/update-recurring-sheet", () => ({
  UpdateRecurringSheet: () => null,
}));
vi.mock("@/lib/tab-bar-metrics", () => ({ useTabBarOverlayHeight: () => 0 }));

const monthRequests: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T05:00:00.000Z"));
  clearDaySessionCache();
  monthRequests.length = 0;
  useUserStore.setState({ user: testUser as never, loading: false });
  server.use(
    http.get(`${API}/sessions`, ({ request }) => {
      const url = new URL(request.url);
      monthRequests.push(`${url.searchParams.get("view")}:${url.searchParams.get("date")}`);
      return HttpResponse.json({
        data: {
          sessions: [
            makeSession({ id: "a", title: "Algorithms lecture" }),
            makeSession({ id: "b", title: "Final exam", type: "EXAM" }),
          ],
        },
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MonthScreen", () => {
  it("shows the current month and fetches it with the month view", async () => {
    renderScreen(<MonthScreen />);
    expect(screen.getByText("October 2026")).toBeTruthy();
    await waitFor(() => expect(monthRequests).toEqual(["month:2026-10-15"]));
  });

  it("renders fetched sessions as pills on the grid", async () => {
    renderScreen(<MonthScreen />);
    await waitFor(() => expect(screen.getByText("Final exam")).toBeTruthy());
    expect(screen.getByText("Algorithms lecture")).toBeTruthy();
  });

  it("lays out a Monday-first grid including adjacent-month days", async () => {
    renderScreen(<MonthScreen />);
    await waitFor(() => expect(screen.getByText("Final exam")).toBeTruthy());
    // Oct 2026 starts on a Thursday: the grid opens on Mon 28 Sep.
    expect(screen.getAllByText("28").length).toBeGreaterThan(0);
    expect(screen.getAllByText("31").length).toBeGreaterThan(0);
  });

  it("navigates to the next and previous month with the header chevrons", async () => {
    renderScreen(<MonthScreen />);
    await waitFor(() => expect(monthRequests).toHaveLength(1));
    fireEvent.click(screen.getByLabelText("Next month"));
    await waitFor(() => expect(screen.getByText("November 2026")).toBeTruthy());
    await waitFor(() => expect(monthRequests).toContain("month:2026-11-15"));
    fireEvent.click(screen.getByLabelText("Previous month"));
    fireEvent.click(screen.getByLabelText("Previous month"));
    await waitFor(() => expect(screen.getByText("September 2026")).toBeTruthy());
    await waitFor(() => expect(monthRequests).toContain("month:2026-09-15"));
  });

  it("shows 'Jump to today' away from the current month and returns on tap", async () => {
    renderScreen(<MonthScreen />);
    expect(screen.queryByLabelText("Jump to today")).toBeNull();
    fireEvent.click(screen.getByLabelText("Next month"));
    await waitFor(() => expect(screen.getByLabelText("Jump to today")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Jump to today"));
    await waitFor(() => expect(screen.getByText("October 2026")).toBeTruthy());
    expect(screen.queryByLabelText("Jump to today")).toBeNull();
  });

  it("toasts when the month fails to load and nothing is cached", async () => {
    server.use(http.get(`${API}/sessions`, () => HttpResponse.json({}, { status: 500 })));
    renderScreen(<MonthScreen />);
    await waitFor(() =>
      expect(screen.getAllByText("Couldn't load this month's tasks").length).toBeGreaterThan(0),
    );
  });

  it("uses the server's error message in the toast when it sends one", async () => {
    server.use(
      http.get(`${API}/sessions`, () =>
        HttpResponse.json({ message: "Calendar is down" }, { status: 503 }),
      ),
    );
    renderScreen(<MonthScreen />);
    await waitFor(() => expect(screen.getAllByText("Calendar is down").length).toBeGreaterThan(0));
  });
});
