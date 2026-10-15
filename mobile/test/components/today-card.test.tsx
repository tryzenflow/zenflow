import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { StreakBadge } from "@/components/calendar/streak-badge";
import { TodayCard } from "@/components/calendar/today-card";
import { useTodayStore } from "@/hooks/use-today";
import { renderScreen } from "@/test/utils/render";

const TZ = "UTC";

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const session = (id: string, title: string, extra: Record<string, unknown>) =>
  ({
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
  }) as never;

const streak = (extra: Record<string, unknown>) =>
  ({
    current: 0,
    longest: 0,
    freezesAvailable: 0,
    frozenDays: [],
    lastActiveDay: null,
    todayDone: false,
    ...extra,
  }) as never;

describe("TodayCard", () => {
  beforeEach(() => {
    useTodayStore.setState({ sessions: null, streak: null });
  });

  it("shows the next task and ignores classes", () => {
    useTodayStore.setState({
      sessions: [
        session("a", "Calculus", { completedAt: inHours(-1), scheduledStartTime: inHours(-2) }),
        session("b", "Physics", {}),
        session("c", "Skipped thing", { skipped: true }),
        session("d", "Lecture", { type: "LECTURE" }),
      ],
    });
    renderScreen(<TodayCard tz={TZ} onOpenSession={() => {}} />);
    expect(screen.getByText("Physics")).toBeTruthy();
    expect(screen.getByText(/^Next up at/)).toBeTruthy();
    expect(screen.queryByTestId("today-streak")).toBeNull();
  });

  it("reads the empty state when nothing is planned", () => {
    useTodayStore.setState({ sessions: [] });
    renderScreen(<TodayCard tz={TZ} onOpenSession={() => {}} />);
    expect(screen.getByText("Nothing planned today")).toBeTruthy();
  });
});

describe("StreakBadge", () => {
  beforeEach(() => {
    useTodayStore.setState({ sessions: null, streak: null });
  });

  it("shows the day count", () => {
    useTodayStore.setState({ streak: streak({ current: 3 }) });
    renderScreen(<StreakBadge />);
    expect(screen.getByTestId("calendar-header.streak")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("stays visible at zero", () => {
    useTodayStore.setState({ streak: streak({ current: 0 }) });
    renderScreen(<StreakBadge />);
    expect(screen.getByTestId("calendar-header.streak")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("shows before the streak loads", () => {
    renderScreen(<StreakBadge />);
    expect(screen.getByTestId("calendar-header.streak")).toBeTruthy();
  });
});
