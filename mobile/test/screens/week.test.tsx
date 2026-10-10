import { fireEvent, screen, waitFor } from "@testing-library/react";
import { router } from "expo-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeekScreen from "@/app/(app)/index";
import { useUserStore } from "@/hooks/use-user-store";
import { clearDaySessionCache } from "@/lib/session-cache";
import { makeSession } from "@/test/fixtures";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// Chrome and sheets with their own ownership / native deps. The pager,
// header and day timeline are real.
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/checklist/getting-started", () => ({ GettingStarted: () => null }));
vi.mock("@/components/tasks/create-task-fab", () => ({ CreateSessionFab: () => null }));
vi.mock("@/components/calendar/block-actions-sheet", () => ({ BlockActionsSheet: () => null }));
vi.mock("@/components/calendar/reschedule-sheet", () => ({ RescheduleSheet: () => null }));
vi.mock("@/components/calendar/series-slot-pick-sheet", () => ({ SeriesSlotPickSheet: () => null }));
vi.mock("@/components/calendar/update-recurring-sheet", () => ({ UpdateRecurringSheet: () => null }));
vi.mock("@/lib/tab-bar-metrics", () => ({ useTabBarOverlayHeight: () => 0 }));

// "Now" is Thu 15 Oct 2026 12:00 in Ho Chi Minh (UTC+7).
const NOW = "2026-10-15T05:00:00.000Z";
let requests: string[];
/** The pager keeps neighbouring days mounted; the focused one sits on top (z-index 9). */
const focusedPage = (els: HTMLElement[]) => els.find((el) => el.closest('[style*="z-index: 9"]')) ?? els[0];
let sessions: ReturnType<typeof makeSession>[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  clearDaySessionCache();
  requests = [];
  sessions = [makeSession({ id: "a", title: "Algorithms lecture" })];
  useUserStore.setState({ user: testUser as never, loading: false });
  server.use(
    http.get(`${API}/sessions`, ({ request }) => {
      const url = new URL(request.url);
      const date = url.searchParams.get("date");
      requests.push(`${url.searchParams.get("view")}:${date}`);
      // Sessions live on the 15th only, so other days are empty.
      const empty = url.searchParams.get("view") === "day" && date !== "2026-10-15";
      return HttpResponse.json({ data: { sessions: empty ? [] : sessions } });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const block = (id: string) => screen.findByTestId(`task-block.${id}`, undefined, { timeout: 3000 });

describe("WeekScreen", () => {
  it("opens on today's week: month title, Monday-first range and a 'today' chip", async () => {
    renderScreen(<WeekScreen />);
    expect(screen.getByText("October 2026")).toBeTruthy();
    expect(screen.getByText("Oct 12 – Oct 18")).toBeTruthy();
    expect(screen.getByLabelText(/^Thursday, October 15, today/)).toBeTruthy();
    expect(screen.getByLabelText("Monday, October 12")).toBeTruthy();
    expect(screen.getByLabelText("Sunday, October 18")).toBeTruthy();
  });

  it("fetches today's sessions with the day view", async () => {
    renderScreen(<WeekScreen />);
    await block("a");
    expect(requests).toContain("day:2026-10-15");
  });

  it("renders a session block with its time in the user's timezone", async () => {
    renderScreen(<WeekScreen />);
    // 03:00Z-04:00Z is 10:00-11:00 in UTC+7.
    expect((await block("a")).getAttribute("aria-label")).toBe(
      "Algorithms lecture, 10:00 AM to 11:00 AM",
    );
  });

  it("marks the day's session types on its chip", async () => {
    renderScreen(<WeekScreen />);
    await block("a");
    await waitFor(() =>
      expect(screen.getByLabelText("Thursday, October 15, today, Lecture")).toBeTruthy(),
    );
  });

  it("opens the session editor when a block is tapped", async () => {
    renderScreen(<WeekScreen />);
    fireEvent.click(await block("a"));
    expect(router.push).toHaveBeenCalledWith("/task/a/edit");
  });

  it("encodes a recurring occurrence id in the editor route", async () => {
    const id = "series1::2026-10-15T03:00:00.000Z";
    sessions = [makeSession({ id, title: "Weekly lab", seriesId: "series1", rrule: "FREQ=WEEKLY" })];
    renderScreen(<WeekScreen />);
    fireEvent.click(await block(id));
    expect(router.push).toHaveBeenCalledWith(`/task/${encodeURIComponent(id)}/edit`);
  });

  it("offers to add a session on an empty day", async () => {
    renderScreen(<WeekScreen />);
    fireEvent.click(screen.getByLabelText("Friday, October 16"));
    await screen.findAllByLabelText("Add a session to this day");
    fireEvent.click(focusedPage(screen.getAllByLabelText("Add a session to this day")));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/task/new",
        params: { start: expect.stringMatching(/^2026-10-16T/) },
      }),
    );
  });

  it("switches day from the chip strip, loads it and offers 'Jump to today'", async () => {
    renderScreen(<WeekScreen />);
    await block("a");
    expect(screen.queryByLabelText("Jump to today")).toBeNull();
    fireEvent.click(screen.getByLabelText("Friday, October 16"));
    await waitFor(() => expect(requests).toContain("day:2026-10-16"));
    await waitFor(() => expect(screen.getByLabelText("Jump to today")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Jump to today"));
    await waitFor(() => expect(screen.queryByLabelText("Jump to today")).toBeNull());
    await block("a");
  });

  it("deep-links to the day in the `date` param", async () => {
    const { useLocalSearchParams } = await import("expo-router");
    vi.mocked(useLocalSearchParams).mockReturnValue({ date: "2026-10-22T05:00:00.000Z" } as never);
    renderScreen(<WeekScreen />);
    expect(screen.getByText("Oct 19 – Oct 25")).toBeTruthy();
    await waitFor(() => expect(requests).toContain("day:2026-10-22"));
    vi.mocked(useLocalSearchParams).mockReturnValue({} as never);
  });

  it("announces the next upcoming session", async () => {
    // 15:00 local, after 'now' (12:00): the pill points at it.
    sessions = [
      makeSession({ id: "later", title: "Evening review", scheduledStartTime: "2026-10-15T08:00:00.000Z" }),
    ];
    renderScreen(<WeekScreen />);
    await block("later");
    await waitFor(() => expect(screen.getByLabelText(/^Next up:/)).toBeTruthy());
  });
});
