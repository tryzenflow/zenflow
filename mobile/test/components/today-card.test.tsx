import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { TodayCard } from "@/components/calendar/today-card";
import { useTodayStore } from "@/hooks/use-today";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const API = "http://api.test";
const TZ = "UTC";

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const session = (id: string, title: string, extra: Record<string, unknown>) => ({
  id,
  title,
  note: null,
  type: "TASK",
  durationMinutes: 60,
  scheduledStartTime: inHours(1),
  completedAt: null,
  skipped: false,
  tags: [],
  ...extra,
});

function serve(sessions: unknown[], streak: Record<string, unknown>) {
  server.use(
    http.get(`${API}/sessions`, () => HttpResponse.json({ data: { sessions } })),
    http.get(`${API}/users/me/streak`, () =>
      HttpResponse.json({
        data: {
          current: 0,
          longest: 0,
          freezesAvailable: 0,
          frozenDays: [],
          lastActiveDay: null,
          todayDone: false,
          ...streak,
        },
      }),
    ),
  );
}

describe("TodayCard", () => {
  beforeEach(() => {
    useTodayStore.setState({ sessions: null, streak: null });
  });

  it("shows the done count, hours, next session and streak", async () => {
    serve(
      [
        session("a", "Calculus", { completedAt: inHours(-1), durationMinutes: 90, scheduledStartTime: inHours(-2) }),
        session("b", "Physics", { durationMinutes: 60, scheduledStartTime: inHours(1) }),
        session("c", "Skipped thing", { skipped: true, scheduledStartTime: inHours(2) }),
      ],
      { current: 3, freezesAvailable: 1 },
    );
    renderScreen(<TodayCard tz={TZ} onOpenSession={() => {}} />);

    await waitFor(() => expect(screen.getByText("2 sessions, 2.5 h")).toBeTruthy());
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText(/^Next up: Physics/)).toBeTruthy();
    expect(screen.getByTestId("today-streak").textContent).toBe("3 day streak");
    expect(screen.getByText("1 freeze ready")).toBeTruthy();
  });

  it("reads the empty state when nothing is planned", async () => {
    serve([], {});
    renderScreen(<TodayCard tz={TZ} onOpenSession={() => {}} />);
    await waitFor(() => expect(screen.getByText("Nothing planned today")).toBeTruthy());
    expect(screen.getByTestId("today-streak").textContent).toBe("No streak yet");
    expect(screen.queryByText(/freeze ready/)).toBeNull();
  });
});
