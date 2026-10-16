import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeekGrid } from "@/components/calendar/week-grid";
import { HOUR_HEIGHT_DEFAULT } from "@/lib/day-grid";
import { clearDaySessionCache } from "@/lib/session-cache";
import { makeSession } from "@/test/fixtures";
import { panTranslation } from "@/test/mocks/gesture-handler";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

vi.mock("@/lib/tab-bar-metrics", () => ({ useTabBarOverlayHeight: () => 0 }));

const TZ = "Asia/Ho_Chi_Minh";
// Thu 15 Oct 2026. In UTC+7: the pinned lecture is 10:00 to 11:00, the drag
// source is 14:00 to 15:00.
const ANCHOR = new Date(2026, 9, 15, 12);
const PX_PER_MIN = HOUR_HEIGHT_DEFAULT / 60;

let patches: string[];
let sessions: ReturnType<typeof makeSession>[];

beforeEach(() => {
  clearDaySessionCache();
  patches = [];
  sessions = [
    makeSession({
      id: "pinned",
      title: "Pinned essay",
      type: "TASK",
      anchor: "PINNED",
      scheduledStartTime: "2026-10-15T03:00:00.000Z",
      durationMinutes: 60,
    }),
    makeSession({
      id: "drag",
      title: "Drag me",
      type: "TASK",
      anchor: "AUTO",
      scheduledStartTime: "2026-10-15T07:00:00.000Z",
      durationMinutes: 60,
    }),
  ];
  server.use(
    http.get(`${API}/sessions`, () => HttpResponse.json({ data: { sessions } })),
    http.patch(`${API}/sessions/:id`, async ({ params, request }) => {
      const body = (await request.json()) as { scheduledStartTime?: string };
      patches.push(`${params.id}@${body.scheduledStartTime}`);
      return HttpResponse.json({
        data: {
          ...sessions.find((s) => s.id === params.id),
          scheduledStartTime: body.scheduledStartTime,
          displacedSessions: [],
          undoGroupId: null,
        },
      });
    }),
  );
});

function renderWeek() {
  return renderScreen(
    <WeekGrid
      anchor={ANCHOR}
      tz={TZ}
      focusTick={0}
      onWeekChange={() => {}}
      onDayPress={() => {}}
      onSessionPress={() => {}}
    />,
  );
}

/** Drag the "Drag me" block by `minutes` of the day (negative is up). */
function dragBy(minutes: number) {
  panTranslation.y = minutes * PX_PER_MIN;
  fireEvent.doubleClick(screen.getByTestId("task-block.drag"));
}

describe("WeekGrid drop onto a pinned block", () => {
  it("bounces the block back and sends nothing", async () => {
    renderWeek();
    await screen.findByTestId("task-block.pinned", undefined, { timeout: 3000 });

    // 14:00 back to 10:30: the dropped hour overlaps the pinned 10:00 to 11:00.
    dragBy(-210);

    expect(
      await screen.findByText("A pinned or fixed session is in the way.", undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy();
    expect(patches).toEqual([]);
  });

  it("still moves a session dropped on free time", async () => {
    renderWeek();
    await screen.findByTestId("task-block.pinned", undefined, { timeout: 3000 });

    // 14:00 to 17:00, clear of every block.
    dragBy(180);

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatch(/^drag@2026-10-15T10:00:00/);
    expect(patches[0]).not.toContain("pinned");
  });
});
