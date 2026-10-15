import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeekGrid } from "@/components/calendar/week-grid";
import { useUserStore } from "@/hooks/use-user-store";
import { clearDaySessionCache } from "@/lib/session-cache";
import { makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// Wednesday 14 Oct 2026, UTC. The week is Mon 12 Oct to Sun 18 Oct.
const NOW = new Date("2026-10-14T05:00:00.000Z");
const ANCHOR = new Date(2026, 9, 14);

const requests: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearDaySessionCache();
  requests.length = 0;
  useUserStore.setState({ user: { ...testUser, timezone: "UTC" } as never, loading: false });
  server.use(
    http.get(`${API}/sessions`, ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.searchParams.get("view")}:${url.searchParams.get("date")}`);
      return HttpResponse.json({
        data: {
          sessions: [
            makeSession({
              id: "a",
              title: "Algorithms lecture",
              scheduledStartTime: "2026-10-14T09:00:00.000Z",
              durationMinutes: 60,
            }),
            makeSession({
              id: "b",
              title: "Lab report",
              scheduledStartTime: "2026-10-16T14:00:00.000Z",
              durationMinutes: 90,
            }),
          ],
        },
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function renderGrid() {
  const props = {
    anchor: ANCHOR,
    tz: "UTC",
    focusTick: 0,
    onWeekChange: vi.fn(),
    onDayPress: vi.fn<(day: Date) => void>(),
    onSessionPress: vi.fn<(taskId: string) => void>(),
  };
  renderScreen(<WeekGrid {...props} />);
  return props;
}

describe("WeekGrid", () => {
  it("shows the seven days of the week, Monday first", async () => {
    renderGrid();
    expect(await screen.findByLabelText("Monday, October 12")).toBeTruthy();
    expect(screen.getByLabelText("Sunday, October 18")).toBeTruthy();
    expect(screen.getByLabelText("Tuesday, October 13")).toBeTruthy();
  });

  it("fetches the week view from the Monday of the week", async () => {
    renderGrid();
    await waitFor(() => expect(requests).toContain("week:2026-10-12"));
  });

  it("renders each session's title in its day column", async () => {
    renderGrid();
    expect(await screen.findByText("Algorithms lecture")).toBeTruthy();
    expect(screen.getByText("Lab report")).toBeTruthy();
  });

  it("opens Day view on the tapped day", async () => {
    const props = renderGrid();
    fireEvent.click(await screen.findByLabelText("Thursday, October 15"));
    expect(props.onDayPress).toHaveBeenCalledTimes(1);
    const day = props.onDayPress.mock.calls[0][0] as Date;
    expect(day.getDate()).toBe(15);
    expect(day.getMonth()).toBe(9);
  });

  it("opens a session on tap", async () => {
    const props = renderGrid();
    fireEvent.click(await screen.findByText("Algorithms lecture"));
    expect(props.onSessionPress).toHaveBeenCalledWith("a");
  });
});
