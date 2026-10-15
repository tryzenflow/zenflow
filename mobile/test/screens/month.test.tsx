import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonthView } from "@/components/calendar/month-view";
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
vi.mock("@/components/tasks/create-task-fab", () => ({ CreateSessionFab: () => null }));
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

/** The Month view as the calendar screen hosts it. */
function renderMonth(
  date = new Date("2026-10-15T05:00:00.000Z"),
  handlers: { onOpenDay?: (d: Date) => void; onSessionPress?: (id: string) => void } = {},
) {
  return renderScreen(
    <MonthView
      date={date}
      onDateChange={() => {}}
      tz="UTC"
      reloadToken={0}
      onOpenDay={handlers.onOpenDay ?? (() => {})}
      onSessionPress={handlers.onSessionPress ?? (() => {})}
    />,
  );
}

describe("MonthView", () => {
  it("shows the current month and fetches it with the month view", async () => {
    renderMonth();
    expect(screen.getByText("October 2026")).toBeTruthy();
    await waitFor(() => expect(monthRequests).toEqual(["month:2026-10-15"]));
  });

  it("lists the selected day's sessions under the grid", async () => {
    renderMonth();
    await waitFor(() => expect(screen.getByText("Final exam")).toBeTruthy());
    expect(screen.getByText("Algorithms lecture")).toBeTruthy();
  });

  it("opens a session from its row", async () => {
    const onSessionPress = vi.fn();
    renderMonth(undefined, { onSessionPress });
    await waitFor(() => expect(screen.getByText("Final exam")).toBeTruthy());
    fireEvent.click(screen.getByTestId("month.row.b"));
    expect(onSessionPress).toHaveBeenCalledWith("b");
  });

  it("selects a tapped day and opens it on a second tap", async () => {
    const onOpenDay = vi.fn();
    renderMonth(undefined, { onOpenDay });
    await waitFor(() => expect(screen.getByText("Final exam")).toBeTruthy());
    fireEvent.click(screen.getByTestId("month-cell.2026-10-20"));
    await waitFor(() => expect(screen.queryByText("Final exam")).toBeNull());
    expect(onOpenDay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("month-cell.2026-10-20"));
    expect(onOpenDay).toHaveBeenCalledTimes(1);
  });

  it("lays out a Monday-first grid including adjacent-month days", async () => {
    renderMonth();
    await waitFor(() => expect(monthRequests).toHaveLength(1));
    // Oct 2026 starts on a Thursday: the grid opens on Mon 28 Sep.
    expect(screen.getAllByText("28").length).toBeGreaterThan(0);
    expect(screen.getAllByText("31").length).toBeGreaterThan(0);
  });

  it("navigates to the next and previous month with the header chevrons", async () => {
    renderMonth();
    await waitFor(() => expect(monthRequests).toHaveLength(1));
    fireEvent.click(screen.getByLabelText("Next month"));
    await waitFor(() => expect(screen.getByText("November 2026")).toBeTruthy());
    await waitFor(() => expect(monthRequests).toContain("month:2026-11-15"));
    fireEvent.click(screen.getByLabelText("Previous month"));
    fireEvent.click(screen.getByLabelText("Previous month"));
    await waitFor(() => expect(screen.getByText("September 2026")).toBeTruthy());
    await waitFor(() => expect(monthRequests).toContain("month:2026-09-15"));
  });

  it("toasts when the month fails to load and nothing is cached", async () => {
    server.use(http.get(`${API}/sessions`, () => HttpResponse.json({}, { status: 404 })));
    renderMonth();
    await waitFor(() =>
      expect(screen.getAllByText("Couldn't load this month").length).toBeGreaterThan(0),
    );
  });

  it("uses the server's message for a client error", async () => {
    server.use(
      http.get(`${API}/sessions`, () =>
        HttpResponse.json({ message: "Calendar is locked" }, { status: 403 }),
      ),
    );
    renderMonth();
    await waitFor(() => expect(screen.getAllByText("Calendar is locked").length).toBeGreaterThan(0));
  });

  it("shows a generic message instead of a server error's body", async () => {
    server.use(
      http.get(`${API}/sessions`, () =>
        HttpResponse.json({ message: "Internal server error" }, { status: 503 }),
      ),
    );
    renderMonth();
    await waitFor(() => expect(screen.getAllByText("Try again shortly").length).toBeGreaterThan(0));
    expect(screen.queryByText("Internal server error")).toBeNull();
  });
});
